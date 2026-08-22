// @vitest-environment jsdom
//
// "O produto que a lojista excluiu continua na vitrine": a exclusão de produto
// deste app é *soft-delete* -- `useProducts` grava `deleted_at` com um UPDATE
// em `produtos`, não um DELETE. O evento chega ao `RealtimeSyncEngine` como
// UPDATE, e o `case "UPDATE"` grava o registro de volta no cofre (IndexedDB)
// com `vault.put`. O `StoreContext` relê o cofre, a `HomeView` não filtra por
// `isActive`, e o produto excluído reaparece com preço e estoque.
//
// Estes casos exercitam `_applyChangeAndNotify` direto, com um dublê de
// `DataVault`: o que interessa é O QUE O COFRE RECEBEU.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncEvent } from "@/lib/realtimeSyncEngine";

// `realtimeSyncEngine.ts` importa `@/lib/supabase` no topo do módulo, e o
// client real falha ao construir em jsdom (sem Web Worker). O dublê evita
// isso -- nenhum caso deste arquivo chama a rede, timer ou IndexedDB de
// verdade.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const { RealtimeSyncEngine, TABLE_CONFIGS } = await import(
  "@/lib/realtimeSyncEngine"
);

function configDe(tabela: string) {
  const config = TABLE_CONFIGS.find((c) => c.table === tabela);
  expect(config, `TABLE_CONFIGS não tem a tabela "${tabela}"`).toBeDefined();
  return config!;
}

function criarDubleVault() {
  return {
    put: vi.fn(async (_store: string, _registro: any) => undefined),
    deleteById: vi.fn(async (_store: string, _id: string) => undefined),
    setLastSync: vi.fn(async () => undefined),
    getById: vi.fn(async () => undefined),
    getByIndex: vi.fn(async () => []),
  };
}

describe("realtimeSyncEngine — produto excluído não volta para o cache", () => {
  let vault: ReturnType<typeof criarDubleVault>;
  let eventosRecebidos: SyncEvent[];
  // `_listeners` é um singleton de módulo: ouvinte esquecido contamina o caso
  // seguinte, então cada caso registra o seu e o `afterEach` remove.
  let removerOuvinte: () => void;

  beforeEach(() => {
    vault = criarDubleVault();
    eventosRecebidos = [];
    removerOuvinte = RealtimeSyncEngine.onSync((evento) => {
      eventosRecebidos.push(evento);
    });
  });

  afterEach(() => {
    removerOuvinte();
  });

  it("apaga do cofre o produto que a lojista excluiu, em vez de gravá-lo de volta", async () => {
    const config = configDe("produtos");

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      config,
      "UPDATE",
      {
        id: "prod-excluido",
        nome: "Camiseta",
        preco_venda: 49.9,
        estoque: 3,
        ativo: false,
        deleted_at: "2026-08-22T21:00:00Z",
      },
      // Num soft-delete o registro inteiro vem no `new`; o `old` não traz o id.
      {},
    );

    expect(vault.put).not.toHaveBeenCalled();
    expect(vault.deleteById).toHaveBeenCalledWith("products", "prod-excluido");
  });

  it("continua gravando normalmente o produto que só foi editado", async () => {
    const config = configDe("produtos");

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      config,
      "UPDATE",
      {
        id: "prod-vivo",
        nome: "Caneca",
        preco_venda: 29.9,
        estoque: 7,
        ativo: true,
        deleted_at: null,
      },
      {},
    );

    expect(vault.deleteById).not.toHaveBeenCalled();
    expect(vault.put).toHaveBeenCalledTimes(1);
    const [store, gravado] = vault.put.mock.calls[0];
    expect(store).toBe("products");
    expect(gravado.id).toBe("prod-vivo");
  });

  it("não deixa entrar no cofre um produto que já chega excluído", async () => {
    const config = configDe("produtos");

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      config,
      "INSERT",
      {
        id: "prod-nasceu-excluido",
        nome: "Item importado",
        preco_venda: 10,
        estoque: 1,
        ativo: false,
        deleted_at: "2026-08-22T21:00:00Z",
      },
      {},
    );

    expect(vault.put).not.toHaveBeenCalled();
    expect(vault.deleteById).toHaveBeenCalledWith(
      "products",
      "prod-nasceu-excluido",
    );
  });

  // Os dois casos acima passam `old: {}`, que é o pior caso: sem id no `old`,
  // só o ramo de reserva (`raw?.id`) acha o produto. Na vida real o Supabase
  // manda a chave primária no `old` de um UPDATE (REPLICA IDENTITY default),
  // e é o ramo primário que roda. Sem este caso, inverter a precedência para
  // `raw?.id ?? old?.id` deixaria a suíte verde.
  it("apaga do cofre também quando o evento traz o id no registro antigo", async () => {
    const config = configDe("produtos");

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      config,
      "UPDATE",
      {
        id: "prod-excluido",
        nome: "Camiseta",
        preco_venda: 49.9,
        estoque: 3,
        ativo: false,
        deleted_at: "2026-08-22T21:00:00Z",
      },
      { id: "prod-excluido" },
    );

    expect(vault.put).not.toHaveBeenCalled();
    expect(vault.deleteById).toHaveBeenCalledWith("products", "prod-excluido");
  });

  it("continua apagando do cofre quando a exclusão é um DELETE de verdade", async () => {
    const config = configDe("produtos");

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      config,
      "DELETE",
      {},
      { id: "prod-apagado-de-vez" },
    );

    expect(vault.put).not.toHaveBeenCalled();
    expect(vault.deleteById).toHaveBeenCalledWith(
      "products",
      "prod-apagado-de-vez",
    );
  });

  it("avisa a interface que o produto sumiu, e não que ele mudou", async () => {
    const config = configDe("produtos");

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      config,
      "UPDATE",
      {
        id: "prod-excluido",
        nome: "Camiseta",
        preco_venda: 49.9,
        estoque: 3,
        ativo: false,
        deleted_at: "2026-08-22T21:00:00Z",
      },
      {},
    );

    const eventosDeProduto = eventosRecebidos.filter(
      (e) => e.store === "products",
    );
    expect(eventosDeProduto).toHaveLength(1);
    expect(eventosDeProduto[0].eventType).toBe("DELETE");
    expect(eventosDeProduto[0].newRecord).toBeUndefined();
    expect(eventosDeProduto[0].oldRecord?.id).toBe("prod-excluido");
  });

  it("não mexe em tabela que nem tem exclusão lógica", async () => {
    const config = configDe("categorias");

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      config,
      "UPDATE",
      { id: "cat-1", nome: "Doces", ativo: true },
      {},
    );

    expect(vault.deleteById).not.toHaveBeenCalled();
    expect(vault.put).toHaveBeenCalledTimes(1);
    const [store, gravado] = vault.put.mock.calls[0];
    expect(store).toBe("categories");
    expect(gravado.id).toBe("cat-1");
  });
});
