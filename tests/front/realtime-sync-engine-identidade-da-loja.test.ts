// @vitest-environment jsdom
//
// Bloco "o app para de inventar endereço": a Tarefa 2 acrescentou
// `store_name`, `store_city` e `store_state` à tabela `store_config`, e o
// `StoreContext` já lê e grava os três. Mas `realtimeSyncEngine.ts` tem uma
// TERCEIRA cópia da mesma lista de colunas -- o `mapRecord` que traduz o
// payload cru do Supabase Realtime (e da carga do cofre offline/IndexedDB)
// para o formato de `StoreConfig` -- e essa cópia não conhecia os três
// campos novos. Sem eles, a identidade da loja definida em Ajustes some
// assim que o app sincroniza pelo caminho offline/realtime em vez de vir
// direto do `StoreContext`.
import { describe, expect, it, vi } from "vitest";
import { pacoteDeMarca } from "./fixtures/branding-assets";

// `realtimeSyncEngine.ts` importa `@/lib/supabase` no topo do módulo, e o
// client real falha ao construir em jsdom (sem Web Worker). O dublê evita
// isso -- nenhum caso deste arquivo chama a rede, só o `mapRecord` puro.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const { TABLE_CONFIGS } = await import("@/lib/realtimeSyncEngine");

it("sincronizar categorias preserva o ícone escolhido e tolera banco antigo", () => {
  const mapear = TABLE_CONFIGS.find((c) => c.table === "categorias")!
    .mapRecord!;
  expect(mapear({ id: "c1", nome: "Brinquedo", icone: "moda" }).icone).toBe(
    "moda",
  );
  expect(mapear({ id: "c1", nome: "Brinquedo" }).icone ?? null).toBeNull();
});

describe("realtimeSyncEngine — identidade da loja no mapRecord de store_config", () => {
  function mapearStoreConfig(raw: Record<string, unknown>) {
    const tabela = TABLE_CONFIGS.find((c) => c.table === "store_config");
    expect(tabela).toBeDefined();
    expect(tabela!.mapRecord).not.toBeNull();
    return tabela!.mapRecord!(raw);
  }

  it("traduz store_name, store_city e store_state para o formato do StoreConfig", () => {
    const mapeado = mapearStoreConfig({
      store_name: "Loja Teste",
      store_city: "Uberlândia",
      store_state: "MG",
    });

    expect(mapeado.storeName).toBe("Loja Teste");
    expect(mapeado.storeCity).toBe("Uberlândia");
    expect(mapeado.storeState).toBe("MG");
  });

  it.each([undefined, null, pacoteDeMarca()])(
    "transporta pacote e cores sem inventar valores: %s",
    (pacote) => {
      const raw =
        pacote === undefined
          ? {}
          : {
              secondary_color: pacote === null ? null : "#FFFFFF",
              accent_color: pacote === null ? null : "#C99730",
              branding_assets: pacote,
            };
      const mapeado = mapearStoreConfig(raw);
      expect(mapeado.secondaryColor).toBe(
        pacote === undefined ? undefined : pacote === null ? null : "#FFFFFF",
      );
      expect(mapeado.accentColor).toBe(
        pacote === undefined ? undefined : pacote === null ? null : "#C99730",
      );
      expect(mapeado.brandingAssets).toEqual(pacote);
    },
  );

  it("preserva os dados públicos e as formas ligadas ao guardar e reler o cache", async () => {
    const { RealtimeSyncEngine } = await import("@/lib/realtimeSyncEngine");
    const registros = new Map<string, unknown>();
    const vault = {
      async put(store: string, registro: { id: string }) {
        registros.set(`${store}:${registro.id}`, structuredClone(registro));
      },
      async getById(store: string, id: string) {
        return structuredClone(registros.get(`${store}:${id}`));
      },
      async setLastSync() {},
    };
    const tabela = TABLE_CONFIGS.find((c) => c.table === "store_config")!;
    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      tabela,
      "UPDATE",
      {
        id: 1,
        store_address: "Rua de Teste, 123",
        store_description: "Uma loja de testes",
        store_legal_name: "Loja Exemplo Ltda",
        store_legal_document: "00000000000000",
        store_support_email: "suporte@example.com",
        formas_pagamento_entrega: ["pix", "cash"],
      },
      {},
    );
    expect(await vault.getById("store_config", "singleton")).toMatchObject({
      storeAddress: "Rua de Teste, 123",
      storeDescription: "Uma loja de testes",
      storeLegalName: "Loja Exemplo Ltda",
      storeLegalDocument: "00000000000000",
      storeSupportEmail: "suporte@example.com",
      formasPagamentoEntrega: ["pix", "cash"],
    });
  });

  it.each([undefined, null, "invalido", ["desconhecido"]])(
    "coluna de pagamento ausente ou inválida preserva o padrão: %s",
    (formas) => {
      const mapeado = mapearStoreConfig({
        formas_pagamento_entrega: formas,
      });
      expect(mapeado.formasPagamentoEntrega).toEqual(["pix", "card", "cash"]);
    },
  );

  it("preserva também a lista de pagamento deliberadamente vazia", () => {
    expect(
      mapearStoreConfig({ formas_pagamento_entrega: [] })
        .formasPagamentoEntrega,
    ).toEqual([]);
  });

  it("não inventa identidade quando o payload não traz os campos", () => {
    const mapeado = mapearStoreConfig({});

    expect(mapeado.storeName).toBeUndefined();
    expect(mapeado.storeCity).toBeUndefined();
    expect(mapeado.storeState).toBeUndefined();
  });
});
