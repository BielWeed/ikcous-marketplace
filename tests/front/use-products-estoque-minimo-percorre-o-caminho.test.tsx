// @vitest-environment jsdom
//
// PAINEL SIMPLES, onda I, frente 3 — `estoqueMinimo` (domínio) tem de virar
// `estoque_minimo` (banco) em TODOS os caminhos de escrita de produto do
// useProducts: o update online, a fila offline (sincronizada em `produtos`) e
// o insert de produto novo.
//
// A regra que cada caminho preserva:
//   * número (inclusive ZERO — é escolha da lojista) chega ao banco como está;
//   * `null` chega como `null` (volta ao padrão, 5): é a lojista limpando o
//     campo, e `null` precisa atravessar a guarda;
//   * `undefined` NÃO chega ("não mexi"): a chave nem existe no payload.
//
// Mesmo padrão de use-products-codigo-de-barras-percorre-o-caminho.test.tsx:
// uma sonda monta só `useProducts` e o dublê de `@/lib/supabase` registra o
// corpo de cada chamada — é isso que prova QUAL payload chegou ao banco.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Chamada = {
  tabela: string;
  op: "insert" | "update" | "upsert";
  payload: any;
};

// `vi.hoisted`: os factories de `vi.mock` rodam no topo do arquivo, antes de
// qualquer `const` comum (TDZ).
const mock = vi.hoisted(() => ({
  fetchProductsContext: vi.fn().mockResolvedValue(undefined),
  chamadas: [] as Chamada[],
  resultados: {} as Record<string, { data?: any; error?: any }>,
}));

const RESULTADO_PADRAO = { data: {}, error: null };
const FILA = "products_offline_updates_queue";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: mock.fetchProductsContext,
  }),
}));

vi.mock("@/lib/mappers", () => ({
  mapProductFromDB: (row: any) => row,
  mapVariantFromDB: (row: any) => row,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

function encadear(resultado: { data?: any; error?: any }) {
  const chain = Promise.resolve(resultado) as Promise<typeof resultado> & {
    eq: () => typeof chain;
    select: () => typeof chain;
    single: () => Promise<typeof resultado>;
  };
  chain.eq = () => chain;
  chain.select = () => chain;
  chain.single = () => Promise.resolve(resultado);
  return chain;
}

function registrar(tabela: string, op: Chamada["op"], payload: any) {
  mock.chamadas.push({ tabela, op, payload });
  return mock.resultados[`${tabela}:${op}`] ?? RESULTADO_PADRAO;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      insert: (payload: any) => encadear(registrar(tabela, "insert", payload)),
      update: (payload: any) => encadear(registrar(tabela, "update", payload)),
      upsert: (payload: any) => encadear(registrar(tabela, "upsert", payload)),
    }),
    auth: { refreshSession: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ApiUseProducts = ReturnType<typeof useProducts>;

function Sonda({ onReady }: { onReady: (api: ApiUseProducts) => void }) {
  const api = useProducts({ autoFetch: false });
  useEffect(() => {
    onReady(api);
  });
  return null;
}

function chamadasDe(tabela: string, op: Chamada["op"]) {
  return mock.chamadas.filter((c) => c.tabela === tabela && c.op === op);
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("useProducts — estoqueMinimo percorre o caminho inteiro do dado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let apiRef: ApiUseProducts | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let onLine: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.fetchProductsContext.mockResolvedValue(undefined);
    mock.chamadas.length = 0;
    mock.resultados = {};
    apiRef = undefined;
    localStorage.removeItem(FILA);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Offline por padrão: sem isto o efeito de sincronizar a fila agenda um
    // setTimeout real. Os testes da fila ligam a rede de propósito.
    onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    localStorage.removeItem(FILA);
    consoleErrorSpy.mockRestore();
    onLine.mockRestore();
  });

  async function montar() {
    await act(async () => {
      raiz.render(
        <Sonda
          onReady={(api) => {
            apiRef = api;
          }}
        />,
      );
    });
  }

  describe("(a) updateProduct — dbUpdates online de vw_produtos_admin", () => {
    it("número manda estoque_minimo", async () => {
      onLine.mockReturnValue(true);
      await montar();
      await act(async () => {
        await apiRef!.updateProduct("prod-1", { estoqueMinimo: 7 });
      });
      const [chamada] = chamadasDe("vw_produtos_admin", "update");
      expect(chamada.payload).toMatchObject({ estoque_minimo: 7 });
    });

    it("ZERO manda 0 — não vira null nem some", async () => {
      onLine.mockReturnValue(true);
      await montar();
      await act(async () => {
        await apiRef!.updateProduct("prod-1", { estoqueMinimo: 0 });
      });
      const [chamada] = chamadasDe("vw_produtos_admin", "update");
      expect(chamada.payload.estoque_minimo).toBe(0);
    });

    it("null manda estoque_minimo: null (volta ao padrão)", async () => {
      onLine.mockReturnValue(true);
      await montar();
      await act(async () => {
        await apiRef!.updateProduct("prod-1", { estoqueMinimo: null });
      });
      const [chamada] = chamadasDe("vw_produtos_admin", "update");
      expect(chamada.payload).toHaveProperty("estoque_minimo", null);
    });

    it("sem estoqueMinimo no patch, a chave estoque_minimo não é mandada", async () => {
      onLine.mockReturnValue(true);
      await montar();
      await act(async () => {
        await apiRef!.updateProduct("prod-1", { name: "Novo nome" });
      });
      const [chamada] = chamadasDe("vw_produtos_admin", "update");
      expect(chamada.payload).not.toHaveProperty("estoque_minimo");
      expect(chamada.payload).toMatchObject({ nome: "Novo nome" });
    });
  });

  describe("(b) fila offline — o que sincroniza em produtos", () => {
    async function sincronizar() {
      onLine.mockReturnValue(true);
      await montar();
      await act(async () => {
        await esperar(1200);
      });
    }

    it("número na fila chega a produtos como estoque_minimo", async () => {
      localStorage.setItem(
        FILA,
        JSON.stringify([
          { id: "prod-1", updates: { estoqueMinimo: 7 }, timestamp: 1 },
        ]),
      );
      await sincronizar();
      const [chamada] = chamadasDe("produtos", "update");
      expect(chamada.payload).toMatchObject({ estoque_minimo: 7 });
    });

    it("ZERO na fila chega como 0", async () => {
      localStorage.setItem(
        FILA,
        JSON.stringify([
          { id: "prod-1", updates: { estoqueMinimo: 0 }, timestamp: 1 },
        ]),
      );
      await sincronizar();
      const [chamada] = chamadasDe("produtos", "update");
      expect(chamada.payload.estoque_minimo).toBe(0);
    });

    it("null na fila chega como null", async () => {
      localStorage.setItem(
        FILA,
        JSON.stringify([
          { id: "prod-1", updates: { estoqueMinimo: null }, timestamp: 1 },
        ]),
      );
      await sincronizar();
      const [chamada] = chamadasDe("produtos", "update");
      expect(chamada.payload).toHaveProperty("estoque_minimo", null);
    });

    it("item da fila sem estoqueMinimo não manda a chave", async () => {
      localStorage.setItem(
        FILA,
        JSON.stringify([
          { id: "prod-1", updates: { name: "Só o nome" }, timestamp: 1 },
        ]),
      );
      await sincronizar();
      const [chamada] = chamadasDe("produtos", "update");
      expect(chamada.payload).not.toHaveProperty("estoque_minimo");
      expect(chamada.payload).toMatchObject({ nome: "Só o nome" });
    });

    it("ponta a ponta: updateProduct offline enfileira e o 'online' leva o número ao banco", async () => {
      await montar();
      await act(async () => {
        await apiRef!.updateProduct("prod-1", { estoqueMinimo: 3 });
      });
      expect(chamadasDe("vw_produtos_admin", "update")).toHaveLength(0);
      const fila = JSON.parse(localStorage.getItem(FILA) ?? "[]");
      expect(fila[0].updates.estoqueMinimo).toBe(3);

      onLine.mockReturnValue(true);
      await act(async () => {
        window.dispatchEvent(new Event("online"));
        await esperar(1200);
      });
      const [chamada] = chamadasDe("produtos", "update");
      expect(chamada.payload).toMatchObject({ estoque_minimo: 3 });
    });
  });

  describe("(c) addProduct — insert do produto novo", () => {
    const base = {
      name: "Caneca Térmica",
      price: 79.9,
      stock: 10,
      images: [] as string[],
      variants: [] as unknown[],
    };

    async function cadastrar(extra: Record<string, unknown>) {
      mock.resultados["vw_produtos_admin:insert"] = {
        data: { id: "prod-novo" },
        error: null,
      };
      await montar();
      await act(async () => {
        await apiRef!.addProduct({ ...base, ...extra } as any);
      });
      return chamadasDe("vw_produtos_admin", "insert")[0];
    }

    it("número vai no insert", async () => {
      const chamada = await cadastrar({ estoqueMinimo: 7 });
      expect(chamada.payload).toMatchObject({ estoque_minimo: 7 });
    });

    it("ZERO vai no insert como 0", async () => {
      const chamada = await cadastrar({ estoqueMinimo: 0 });
      expect(chamada.payload.estoque_minimo).toBe(0);
    });

    it("null vai no insert como null", async () => {
      const chamada = await cadastrar({ estoqueMinimo: null });
      expect(chamada.payload).toHaveProperty("estoque_minimo", null);
    });

    it("undefined NÃO vai no insert: o banco aplica o padrão da coluna", async () => {
      const chamada = await cadastrar({});
      expect(chamada.payload).not.toHaveProperty("estoque_minimo");
    });
  });
});
