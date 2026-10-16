// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataVault, type StoreName } from "@/lib/dataVault";
import type { SyncEvent } from "@/lib/realtimeSyncEngine";
import type { Product } from "@/types";

const rede = vi.hoisted(() => ({
  resumo: vi.fn<() => Promise<{ data: { id: string }[]; error: null }>>(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      const consulta = {
        select: () => consulta,
        order: () => consulta,
        is: () => consulta,
        single: async () => ({ data: null, error: null }),
        // biome-ignore lint/suspicious/noThenProperty: query builder do Supabase é thenable
        then: (
          resolve: (valor: { data: { id: string }[]; error: null }) => unknown,
        ) =>
          (tabela === "vw_produtos_public"
            ? rede.resumo()
            : Promise.resolve({ data: [], error: null })
          ).then(resolve),
      };
      return consulta;
    },
  },
}));

const { RealtimeSyncEngine: motor, TABLE_CONFIGS } = await import(
  "@/lib/realtimeSyncEngine"
);

function pendente<T>() {
  let concluir!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    concluir = resolve;
  });
  return { promessa, concluir };
}

function copiar<T>(valor: T): T {
  return valor === undefined
    ? valor
    : (JSON.parse(JSON.stringify(valor)) as unknown as T);
}

// Sem dependência nova: só a fronteira IDB é dublada. DataVault e motor são
// reais. Cada readwrite segura leitura e escrita até completar, inclusive
// entre duas conexões; get/put separados deixam duas leituras pegarem 5/5.
function bancoEmMemoria() {
  const lojas = new Map<string, Map<string, unknown>>();
  let fila = Promise.resolve();
  const db = {
    transaction(nome: string, modo: IDBTransactionMode) {
      const loja = lojas.get(nome) ?? new Map<string, unknown>();
      lojas.set(nome, loja);
      const tarefas: (() => void)[] = [];
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        error: null,
        abort: () => {
          tx.onabort?.();
        },
        objectStore: () => ({
          get(id: string) {
            const req = {
              result: undefined as unknown,
              onsuccess: null as (() => void) | null,
            };
            tarefas.push(() => {
              req.result = copiar(loja.get(id));
              req.onsuccess?.();
            });
            return req;
          },
          getAll() {
            const req = {
              result: [] as unknown[],
              onsuccess: null as (() => void) | null,
            };
            tarefas.push(() => {
              req.result = copiar([...loja.values()]);
              req.onsuccess?.();
            });
            return req;
          },
          put(registro: { id?: string; store?: string }) {
            if (modo !== "readwrite")
              throw new DOMException(
                "Transação só de leitura",
                "ReadOnlyError",
              );
            const copia = copiar(registro);
            tarefas.push(() => {
              loja.set((copia.id ?? copia.store)!, copia);
            });
          },
          clear() {
            tarefas.push(() => {
              loja.clear();
            });
          },
          delete(id: string) {
            const req = { onsuccess: null as (() => void) | null };
            tarefas.push(() => {
              loja.delete(id);
              req.onsuccess?.();
            });
            return req;
          },
          index: () => ({
            getAll: () => {
              const req = {
                result: [],
                onsuccess: null as (() => void) | null,
              };
              tarefas.push(() => req.onsuccess?.());
              return req;
            },
          }),
        }),
      };
      fila = fila.then(() => {
        // O callback de get pode acrescentar o put à MESMA transação.
        for (let i = 0; i < tarefas.length; i++) tarefas.at(i)!();
        tx.oncomplete?.();
      });
      return tx;
    },
  };
  return () => {
    const cofre = Object.create(DataVault.prototype) as unknown as DataVault;
    (cofre as unknown as { db: unknown }).db = db;
    return cofre;
  };
}

// Força a janela antiga: duas leituras independentes capturam o pai antes
// de devolverem suas cópias. A mutação atômica mantém a leitura dentro de
// readwrite, sem passar pelo getById separado que abria essa janela.
function sobreporLeituras(cofre: DataVault) {
  const ler = cofre.getById.bind(cofre);
  const aguardando: ReturnType<typeof pendente<void>>[] = [];
  const leitura = vi
    .spyOn(cofre, "getById")
    .mockImplementation(
      async <T>(store: StoreName, id: string): Promise<T | undefined> => {
        const valor = await ler<T>(store, id);
        if (store === "products") {
          const espera = pendente<void>();
          aguardando.push(espera);
          if (aguardando.length === 2) {
            for (const item of aguardando) item.concluir();
          }
          await espera.promessa;
        }
        return valor;
      },
    );
  return () => leitura.mockRestore();
}

function produto() {
  return {
    id: "camisa",
    nome: "Camisa",
    preco_venda: 25,
    estoque: 10,
    ativo: true,
    product_variants: [variacao("p", 5), variacao("m", 5)],
  };
}

function variacao(id: string, estoque: number) {
  return {
    id,
    product_id: "camisa",
    name: "Tamanho",
    value: id,
    stock_increment: estoque,
    active: true,
  };
}

function aplicar(
  cofre: DataVault,
  tabela: string,
  raw: unknown,
  tipo: "INSERT" | "UPDATE" = "UPDATE",
) {
  return motor._applyChangeAndNotify(
    cofre,
    TABLE_CONFIGS.find((c) => c.table === tabela)!,
    tipo,
    raw,
    {},
  );
}

let eventos: SyncEvent[];
let remover: () => void;
beforeEach(() => {
  rede.resumo.mockReset().mockResolvedValue({ data: [], error: null });
  eventos = [];
  remover = motor.onSync((evento) => eventos.push(evento));
});
afterEach(() => {
  remover();
});

describe("motor — mutações sobrepostas do mesmo produto", () => {
  it.each([
    ["p", "m"],
    ["m", "p"],
  ])(
    "guarda os dois estoques zerados na ordem %s/%s",
    async (primeira, segunda) => {
      const cofre = bancoEmMemoria()();
      await aplicar(cofre, "produtos", produto(), "INSERT");
      await Promise.all([
        aplicar(cofre, "product_variants", variacao(primeira, 0)),
        aplicar(cofre, "product_variants", variacao(segunda, 0)),
      ]);
      const final = await cofre.getById<Product>("products", "camisa");
      expect(final?.variants?.map((v) => v.stockIncrement)).toEqual([0, 0]);
      expect(final?.stock).toBe(0);
    },
  );

  it.each([true, false])(
    "preserva variações com edição de produto sobreposta (produto primeiro: %s)",
    async (produtoPrimeiro) => {
      const cofre = bancoEmMemoria()();
      await aplicar(cofre, "produtos", produto(), "INSERT");
      const reverterLeituras = sobreporLeituras(cofre);
      const editarProduto = () =>
        aplicar(cofre, "produtos", {
          id: "camisa",
          nome: "Camisa azul",
          estoque: 10,
        });
      const editarVariacao = () =>
        aplicar(cofre, "product_variants", variacao("p", 0));
      await Promise.all(
        produtoPrimeiro
          ? [editarProduto(), editarVariacao()]
          : [editarVariacao(), editarProduto()],
      );
      reverterLeituras();
      const final = await cofre.getById<Product>("products", "camisa");
      expect(final?.name).toBe("Camisa azul");
      expect(final?.variants?.map((v) => v.stockIncrement)).toEqual([0, 5]);
      expect(final?.stock).toBe(5);
    },
  );

  it("duas conexões no mesmo banco não desfazem a variação gravada pela outra aba", async () => {
    const conectar = bancoEmMemoria();
    const lider = conectar();
    const secundaria = conectar();
    await aplicar(lider, "produtos", produto(), "INSERT");
    await Promise.all([
      aplicar(lider, "product_variants", variacao("p", 0)),
      aplicar(secundaria, "product_variants", variacao("m", 0)),
    ]);
    const final = await lider.getById<Product>("products", "camisa");
    expect(final?.variants?.map((v) => v.stockIncrement)).toEqual([0, 0]);
    expect(final?.stock).toBe(0);
  });

  it("evento isolado mantém o estoque, os campos do produto e o aviso sintético", async () => {
    const cofre = bancoEmMemoria()();
    await aplicar(cofre, "produtos", produto(), "INSERT");
    eventos.length = 0;
    await aplicar(cofre, "product_variants", variacao("p", 2));
    const final = await cofre.getById<Product>("products", "camisa");
    expect(final?.name).toBe("Camisa");
    expect(final?.variants?.map((v) => v.stockIncrement)).toEqual([2, 5]);
    expect(final?.stock).toBe(7);
    expect(eventos.map((e) => [e.store, e.eventType])).toEqual([
      ["products", "UPDATE"],
      ["product_variants", "UPDATE"],
    ]);
    expect(eventos[0].newRecord).toEqual(final);
  });
});

describe("motor — resumo de catchUp anterior ao realtime", () => {
  it.each(["INSERT", "UPDATE"] as const)(
    "não apaga produto tocado por %s durante resumo lento, mas reconfere na próxima rodada",
    async (tipo) => {
      const cofre = bancoEmMemoria()();
      await aplicar(
        cofre,
        "produtos",
        { id: "antigo", nome: "Produto removido", estoque: 1 },
        "INSERT",
      );
      if (tipo === "UPDATE")
        await aplicar(cofre, "produtos", produto(), "INSERT");
      const iniciou = pendente<void>();
      const resposta = pendente<{ data: { id: string }[]; error: null }>();
      rede.resumo.mockImplementationOnce(() => {
        iniciou.concluir();
        return resposta.promessa;
      });
      const rodada = motor.catchUp(cofre, false);
      await iniciou.promessa;
      await aplicar(
        cofre,
        "produtos",
        { id: "camisa", nome: "Camisa nova", estoque: 3 },
        tipo,
      );
      resposta.concluir({ data: [], error: null });
      await rodada;
      expect((await cofre.getById<Product>("products", "camisa"))?.name).toBe(
        "Camisa nova",
      );
      expect(await cofre.getById("products", "antigo")).toBeUndefined();
      // A proteção não atravessa consultas: sem novo evento, a ausência passa
      // a ser confirmada pelo resumo seguinte e a exclusão legítima acontece.
      await motor.catchUp(cofre, false);
      expect(await cofre.getAllOrThrow("products")).toEqual([]);
    },
  );

  it("apaga produto antigo ausente no resumo e avisa a própria vitrine", async () => {
    const cofre = bancoEmMemoria()();
    await aplicar(cofre, "produtos", produto(), "INSERT");
    eventos.length = 0;
    await motor.catchUp(cofre, false);
    expect(await cofre.getAllOrThrow("products")).toEqual([]);
    expect(eventos.some((e) => e.store === "products")).toBe(true);
  });
});

// Uma requisição get bem-sucedida ainda não é commit: put/commit podem falhar.
describe("DataVault — confirmação da mutação atômica", () => {
  it("rejeita se a transação abortar depois da leitura, sem declarar a escrita concluída", async () => {
    const falha = new DOMException("Disco cheio", "QuotaExceededError");
    const request = {
      result: { id: "camisa", stock: 5 },
      onsuccess: null as (() => void) | null,
    };
    const tx = {
      error: falha,
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      objectStore: () => ({ get: () => request, put: () => undefined }),
    };
    const cofre = Object.create(DataVault.prototype) as unknown as DataVault;
    (cofre as unknown as { db: unknown }).db = { transaction: () => tx };
    const escrita = cofre.mutate<{ id: string; stock: number }>(
      "products",
      "camisa",
      (atual) => ({ id: "camisa", stock: (atual?.stock ?? 0) - 1 }),
    );
    request.onsuccess?.();
    tx.onabort?.();
    await expect(escrita).rejects.toBe(falha);
  });
});
