// @vitest-environment jsdom
//
// Caça 9, item 2 — na visão "N produtos sem custo" a lojista exclui um
// produto que NÃO está na página carregada de `useProducts` (a visão guarda a
// própria lista, varrendo todas as páginas). `deleteProduct` procurava o
// produto só em `localProducts` e lançava "Produto não encontrado": a tela
// SEMPRE dizia "Erro ao excluir produto" e nada era excluído. O teste da visão
// usa um dublê de `useProducts`, por isso nunca pegou.
//
// Aqui o hook é o REAL; só o Supabase é simulado (mesmo molde de
// use-products-delete-fases.test.tsx). O produto a excluir não está em
// `products` (a página carregada tem outro produto).
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Chamada =
  | { tipo: "update"; tabela: string; payload: any; id: string }
  | { tipo: "select"; tabela: string; colunas: string; filtros: unknown[] }
  | { tipo: "copy"; from: string; to: string };

const mock = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  fetchProductsContext: vi.fn().mockResolvedValue(undefined),
  ordem: [] as Chamada[],
  /** O que a leitura do produto fora da página devolve (view do painel). */
  produtoFora: {
    data: null as null | { id: string; imagem_urls: string[] | null },
    error: null as null | { message: string },
  },
  variacoesFora: {
    data: [] as Array<{ id: string; image_url: string | null }>,
    error: null as null | { message: string },
  },
  rpcRowsAdmin: [] as any[],
}));

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
  mapProductFromDB: (row: any) => ({
    id: row.id,
    name: row.nome,
    description: "",
    price: row.preco_venda,
    stock: row.estoque,
    category: "Geral",
    images: row.imagem_urls || [],
    isActive: row.ativo ?? true,
    isBestseller: false,
    freeShipping: false,
    sold: 0,
    variants: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mock.toastSuccess,
    error: mock.toastError,
    loading: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) => {
      if (nome === "get_admin_products_paged") {
        return {
          abortSignal: () =>
            Promise.resolve({
              data: {
                data: mock.rpcRowsAdmin,
                total_count: mock.rpcRowsAdmin.length,
              },
              error: null,
            }),
        };
      }
      throw new Error(`RPC não mockada neste teste: ${nome}`);
    },
    from: (tabela: string) => ({
      select: (colunas: string) => {
        const filtros: unknown[] = [];
        const resposta = () =>
          tabela === "product_variants" ? mock.variacoesFora : mock.produtoFora;
        const registrar = () =>
          mock.ordem.push({ tipo: "select", tabela, colunas, filtros });
        const consulta: any = {
          eq: (coluna: string, valor: unknown) => {
            filtros.push([coluna, valor]);
            // As variações são lidas com `.select().eq()` e aguardadas direto
            // (o `.eq` é o último elo); o produto, com `.maybeSingle()`.
            if (tabela === "product_variants") {
              registrar();
              return Promise.resolve(resposta());
            }
            return consulta;
          },
          is: (coluna: string, valor: unknown) => {
            filtros.push([coluna, valor]);
            return consulta;
          },
          maybeSingle: async () => {
            registrar();
            return resposta();
          },
        };
        return consulta;
      },
      update: (payload: any) => ({
        eq: async (_col: string, id: string) => {
          mock.ordem.push({ tipo: "update", tabela, payload, id });
          return { error: null };
        },
      }),
    }),
    storage: {
      from: () => ({
        copy: async (from: string, to: string) => {
          mock.ordem.push({ tipo: "copy", from, to });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://proj.supabase.co/storage/v1/object/public/products/${path}`,
          },
        }),
      }),
    },
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

const FOTO =
  "https://proj.supabase.co/storage/v1/object/public/products/foto-fora.jpg";
const FOTO_VARIACAO =
  "https://proj.supabase.co/storage/v1/object/public/products/variacao-fora.jpg";

const produtoDaPagina = {
  id: "prod-na-pagina",
  nome: "Produto da página",
  preco_venda: 10,
  estoque: 2,
  imagem_urls: [],
  ativo: true,
};

describe("useProducts.deleteProduct — produto fora da página carregada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let apiRef: ApiUseProducts | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.fetchProductsContext.mockResolvedValue(undefined);
    mock.ordem.length = 0;
    mock.produtoFora = {
      data: { id: "prod-fora", imagem_urls: [FOTO] },
      error: null,
    };
    mock.variacoesFora = {
      data: [{ id: "var-fora", image_url: FOTO_VARIACAO }],
      error: null,
    };
    mock.rpcRowsAdmin = [produtoDaPagina];
    apiRef = undefined;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    consoleErrorSpy.mockRestore();
  });

  async function montarECarregar() {
    await act(async () => {
      raiz.render(
        <Sonda
          onReady={(api) => {
            apiRef = api;
          }}
        />,
      );
    });
    await act(async () => {
      await apiRef!.loadProducts(0, 10);
    });
  }

  it("exclui (deleted_at) o produto que não está na página e guarda as fotos dele", async () => {
    await montarECarregar();
    expect(apiRef!.products.map((p) => p.id)).toEqual(["prod-na-pagina"]);

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await apiRef!.deleteProduct("prod-fora");
    });

    expect(resultado).toBe(true);
    expect(mock.toastError).not.toHaveBeenCalled();
    expect(mock.toastSuccess).toHaveBeenCalledWith("Produto removido");

    const apagou = mock.ordem.find(
      (c) =>
        c.tipo === "update" && c.tabela === "produtos" && c.id === "prod-fora",
    ) as Extract<Chamada, { tipo: "update" }> | undefined;
    expect(apagou).toBeDefined();
    // A regra de exclusão não mudou: marca deleted_at e desativa.
    expect(apagou!.payload.ativo).toBe(false);
    expect(apagou!.payload.deleted_at).toBeTruthy();

    // A mesma regra de mídia do produto da página: as fotos vão para backup/
    // DEPOIS do soft-delete confirmado.
    const indiceDoUpdate = mock.ordem.indexOf(apagou!);
    const copias = mock.ordem
      .map((c, i) => (c.tipo === "copy" ? i : -1))
      .filter((i) => i >= 0);
    expect(copias).toHaveLength(2);
    expect(Math.min(...copias)).toBeGreaterThan(indiceDoUpdate);

    // A página carregada fica como estava.
    expect(apiRef!.products.map((p) => p.id)).toEqual(["prod-na-pagina"]);
  });

  it("a consulta de apoio é mínima: só id e fotos, só deste produto, sem apagados", async () => {
    await montarECarregar();
    await act(async () => {
      await apiRef!.deleteProduct("prod-fora");
    });

    const consultas = mock.ordem.filter((c) => c.tipo === "select") as Array<
      Extract<Chamada, { tipo: "select" }>
    >;
    const doProduto = consultas.find((c) => c.tabela !== "product_variants")!;
    expect(doProduto.colunas).toBe("id, imagem_urls");
    expect(doProduto.filtros).toContainEqual(["id", "prod-fora"]);
    expect(doProduto.filtros).toContainEqual(["deleted_at", null]);
    const dasVariacoes = consultas.find(
      (c) => c.tabela === "product_variants",
    )!;
    expect(dasVariacoes.colunas).toBe("id, image_url");
    expect(dasVariacoes.filtros).toContainEqual(["product_id", "prod-fora"]);
  });

  it("produto da página não faz consulta nenhuma de apoio", async () => {
    await montarECarregar();
    await act(async () => {
      await apiRef!.deleteProduct("prod-na-pagina");
    });
    expect(mock.ordem.filter((c) => c.tipo === "select")).toHaveLength(0);
    expect(
      mock.ordem.some((c) => c.tipo === "update" && c.id === "prod-na-pagina"),
    ).toBe(true);
  });

  it("produto que não existe mais (nem fora da página): erro, nada é gravado, a página fica intacta", async () => {
    await montarECarregar();
    mock.produtoFora = { data: null, error: null };

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await apiRef!.deleteProduct("prod-fantasma");
    });

    expect(resultado).toBe(false);
    expect(mock.toastError).toHaveBeenCalledWith("Erro ao excluir produto");
    expect(mock.toastSuccess).not.toHaveBeenCalled();
    expect(mock.ordem.filter((c) => c.tipo === "update")).toHaveLength(0);
    expect(apiRef!.products.map((p) => p.id)).toEqual(["prod-na-pagina"]);
  });

  it("falha ao consultar o produto fora da página: erro, nada é gravado", async () => {
    await montarECarregar();
    mock.produtoFora = { data: null, error: { message: "sem conexão" } };

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await apiRef!.deleteProduct("prod-fora");
    });

    expect(resultado).toBe(false);
    expect(mock.toastError).toHaveBeenCalledWith("Erro ao excluir produto");
    expect(mock.ordem.filter((c) => c.tipo === "update")).toHaveLength(0);
    expect(mock.ordem.filter((c) => c.tipo === "copy")).toHaveLength(0);
  });

  it("falha ao consultar as variações: erro, nada é gravado (não apaga sem saber o que guardar)", async () => {
    await montarECarregar();
    mock.variacoesFora = { data: [], error: { message: "sem conexão" } };

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await apiRef!.deleteProduct("prod-fora");
    });

    expect(resultado).toBe(false);
    expect(mock.toastError).toHaveBeenCalledWith("Erro ao excluir produto");
    expect(mock.ordem.filter((c) => c.tipo === "update")).toHaveLength(0);
  });
});
