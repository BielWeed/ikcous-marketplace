// @vitest-environment jsdom
//
// Três campos do produto que a lojista edita e que NENHUM teste seguia até o
// corpo enviado ao banco (os vizinhos usam dublê do hook, ou um servidor que
// ignora o campo):
//   * `costPrice` -> `custo` (ZERO é "brinde" e tem de ser enviado, não descartado);
//   * `originalPrice` -> `preco_original` (`null` é desligar a promoção: tem de
//     chegar como `null`, senão o preço riscado "De" continua na loja);
//   * `isActive` -> `ativo` no cadastro (duplicar/criar inativo não pode nascer ativo).
//
// Hook REAL (`updateProduct` e `addProduct`), Supabase simulado que registra o
// corpo de cada chamada — mesmo molde de
// use-products-estoque-minimo-percorre-o-caminho.test.tsx.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Chamada = {
  tabela: string;
  op: "insert" | "update";
  payload: any;
  // Filtros encadeados depois do `update`/`insert` — sem eles, o UPDATE em
  // `vw_produtos_admin` valeria para TODOS os produtos da loja.
  filtros: { op: "eq" | "is"; coluna: string; valor: unknown }[];
};

// `vi.hoisted`: os factories de `vi.mock` rodam no topo do arquivo, antes de
// qualquer `const` comum (TDZ).
const mock = vi.hoisted(() => ({
  fetchProductsContext: vi.fn().mockResolvedValue(undefined),
  chamadas: [] as Chamada[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [{ id: "prod-1", name: "Produto 1" }],
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

const RESULTADO = { data: { id: "prod-1" }, error: null };

function encadear(chamada: Chamada) {
  const chain = Promise.resolve(RESULTADO) as Promise<typeof RESULTADO> & {
    eq: (coluna: string, valor: unknown) => typeof chain;
    is: (coluna: string, valor: unknown) => typeof chain;
    select: () => typeof chain;
    single: () => Promise<typeof RESULTADO>;
    maybeSingle: () => Promise<typeof RESULTADO>;
  };
  chain.eq = (coluna, valor) => {
    chamada.filtros.push({ op: "eq", coluna, valor });
    return chain;
  };
  chain.is = (coluna, valor) => {
    chamada.filtros.push({ op: "is", coluna, valor });
    return chain;
  };
  chain.select = () => chain;
  chain.single = () => Promise.resolve(RESULTADO);
  chain.maybeSingle = () => Promise.resolve(RESULTADO);
  return chain;
}

function registrar(tabela: string, op: Chamada["op"], payload: any) {
  const chamada: Chamada = { tabela, op, payload, filtros: [] };
  mock.chamadas.push(chamada);
  return encadear(chamada);
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      insert: (payload: any) => registrar(tabela, "insert", payload),
      update: (payload: any) => registrar(tabela, "update", payload),
    }),
    auth: {
      refreshSession: vi.fn(),
      getSession: async () => ({
        data: { session: { user: { id: "lojista-1" } } },
      }),
    },
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

describe("useProducts — custo, preço de antes e ativo chegam ao banco como a lojista mandou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let apiRef: ApiUseProducts | undefined;
  let onLine: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.fetchProductsContext.mockResolvedValue(undefined);
    mock.chamadas.length = 0;
    apiRef = undefined;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    onLine = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    onLine.mockRestore();
    vi.restoreAllMocks();
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

  async function editar(updates: Record<string, unknown>) {
    await montar();
    await act(async () => {
      await apiRef!.updateProduct("prod-1", updates as any);
    });
    const [chamada] = chamadasDe("vw_produtos_admin", "update");
    expect(chamada).toBeDefined();
    return chamada.payload;
  }

  describe("updateProduct — o UPDATE mira só o produto editado", () => {
    it("filtra por id do produto e por `deleted_at is null` (nunca a tabela inteira)", async () => {
      await montar();
      await act(async () => {
        await apiRef!.updateProduct("prod-1", { name: "Novo nome" } as any);
      });
      const [chamada] = chamadasDe("vw_produtos_admin", "update");
      expect(chamada).toBeDefined();
      expect(chamada.filtros).toContainEqual({
        op: "eq",
        coluna: "id",
        valor: "prod-1",
      });
      expect(chamada.filtros).toContainEqual({
        op: "is",
        coluna: "deleted_at",
        valor: null,
      });
    });

    it("o id filtrado é o do produto que foi editado, não um fixo", async () => {
      await montar();
      await act(async () => {
        await apiRef!.updateProduct("prod-9", { name: "Outro" } as any);
      });
      const [chamada] = chamadasDe("vw_produtos_admin", "update");
      expect(chamada).toBeDefined();
      expect(chamada.filtros).toContainEqual({
        op: "eq",
        coluna: "id",
        valor: "prod-9",
      });
    });
  });

  describe("updateProduct — custo", () => {
    it("custo editado chega ao banco como `custo`", async () => {
      const corpo = await editar({ costPrice: 12.34 });
      expect(corpo.custo).toBe(12.34);
    });

    it("custo ZERO (brinde) é enviado como 0 — não é descartado", async () => {
      const corpo = await editar({ costPrice: 0 });
      expect(corpo).toHaveProperty("custo", 0);
    });

    it("sem costPrice no patch, a chave `custo` não é mandada", async () => {
      const corpo = await editar({ name: "Novo nome" });
      expect(corpo).not.toHaveProperty("custo");
    });
  });

  describe("updateProduct — preço de antes (promoção)", () => {
    it("desligar a promoção (originalPrice: null) manda preco_original: null", async () => {
      const corpo = await editar({ originalPrice: null });
      expect(corpo).toHaveProperty("preco_original", null);
    });

    it("originalPrice numérico chega como `preco_original`", async () => {
      const corpo = await editar({ originalPrice: 99.9 });
      expect(corpo.preco_original).toBe(99.9);
    });

    it("sem originalPrice no patch, a chave `preco_original` não é mandada", async () => {
      const corpo = await editar({ name: "Novo nome" });
      expect(corpo).not.toHaveProperty("preco_original");
    });
  });

  describe("addProduct — o `ativo` do formulário vai no INSERT", () => {
    const base = {
      name: "Camiseta (Cópia)",
      price: 50,
      stock: 3,
      images: [] as string[],
      variants: [] as unknown[],
    };

    async function cadastrar(isActive: boolean) {
      await montar();
      await act(async () => {
        await apiRef!.addProduct({ ...base, isActive } as any);
      });
      const [chamada] = chamadasDe("vw_produtos_admin", "insert");
      expect(chamada).toBeDefined();
      return chamada.payload;
    }

    it("isActive: false nasce com ativo: false (rascunho/cópia não vai à vitrine)", async () => {
      const corpo = await cadastrar(false);
      expect(corpo).toHaveProperty("ativo", false);
    });

    it("isActive: true nasce com ativo: true", async () => {
      const corpo = await cadastrar(true);
      expect(corpo).toHaveProperty("ativo", true);
    });
  });
});
