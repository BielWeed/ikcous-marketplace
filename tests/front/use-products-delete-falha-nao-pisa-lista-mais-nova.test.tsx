// @vitest-environment jsdom
//
// useProducts.deleteProduct: a exclusão que falha devolve o produto à lista,
// mas só se a lista ainda for a de antes. Cenário: na categoria A a lojista
// confirma excluir (a rede demora), troca para a categoria B e vê os produtos
// de B; a exclusão falha ou estoura o prazo. O rollback restaurava o retrato
// guardado ANTES da exclusão (produtos de A) por cima da lista de B: tela com
// os produtos de A, filtro e contagem de B.
//
// Mesmo desenho de use-products-delete-fases.test.tsx: componente sonda que
// só monta o hook, `@/lib/supabase` mockado. Aqui o RPC responde por categoria
// e o UPDATE do soft-delete é uma promessa que o teste resolve na hora certa.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  fetchProductsContext: vi.fn().mockResolvedValue(undefined),
  /** Linhas que o RPC devolve, por categoria pedida ("all" = sem filtro). */
  linhasPorCategoria: {} as Record<string, any[]>,
  /** Resolve o UPDATE do soft-delete que está no ar. */
  resolverUpdate: null as null | ((r: { error: any }) => void),
  /** Faz o RPC de uma categoria ficar no ar até o teste soltar. */
  rpcSegurado: null as null | { categoria: string; soltar: () => void },
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
    price: 10,
    stock: 1,
    category: row.categoria,
    images: [],
    isActive: true,
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
    rpc: (nome: string, args: any) => {
      if (nome !== "get_admin_products_paged") {
        throw new Error(`RPC não mockada neste teste: ${nome}`);
      }
      return {
        abortSignal: async () => {
          const segurado = mock.rpcSegurado;
          if (segurado && segurado.categoria === args.p_category) {
            await new Promise<void>((resolve) => {
              segurado.soltar = resolve;
            });
          }
          const linhas = mock.linhasPorCategoria[args.p_category] ?? [];
          return {
            data: { data: linhas, total_count: linhas.length },
            error: null,
          };
        },
      };
    },
    from: () => ({
      update: () => ({
        eq: (_col: string, id: string) => {
          const resposta = new Promise<{ error: any }>((resolve) => {
            mock.resolverUpdate = resolve;
          });
          return Object.assign(resposta, {
            select: () =>
              resposta.then((r) => ({
                ...r,
                data: r.error ? null : [{ id }],
              })),
          });
        },
      }),
    }),
    storage: {
      from: () => ({
        copy: async () => ({ error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: path } }),
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

const linha = (id: string, categoria: string) => ({
  id,
  nome: `Produto ${id}`,
  categoria,
});

describe("useProducts.deleteProduct — rollback não pisa numa lista mais nova", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let apiRef: ApiUseProducts | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.fetchProductsContext.mockResolvedValue(undefined);
    mock.resolverUpdate = null;
    mock.rpcSegurado = null;
    mock.linhasPorCategoria = {
      all: [linha("a1", "A"), linha("a2", "A"), linha("b1", "B")],
      A: [linha("a1", "A"), linha("a2", "A")],
      B: [linha("b1", "B"), linha("b2", "B")],
    };
    apiRef = undefined;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Sem rede o efeito de sincronizar a fila offline não agenda timer real.
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
  const ids = () => apiRef!.products.map((p) => p.id);

  /** Confirma a exclusão de `id` e deixa o UPDATE no ar. */
  async function excluirSemResposta(id: string) {
    let resultado: boolean | undefined | "pendente" = "pendente";
    await act(async () => {
      void apiRef!.deleteProduct(id).then((r) => {
        resultado = r;
      });
    });
    expect(resultado).toBe("pendente");
    return {
      falhar: async (error: any) => {
        await act(async () => {
          mock.resolverUpdate!({ error });
        });
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        return resultado;
      },
    };
  }

  it("falha depois de trocar para a categoria B: a lista continua sendo a de B", async () => {
    await montar();
    await act(async () => {
      await apiRef!.loadProducts(0, 10, { category: "A" });
    });
    expect(ids()).toEqual(["a1", "a2"]);

    const exclusao = await excluirSemResposta("a1");
    expect(ids()).toEqual(["a2"]); // saiu da tela antes da resposta

    await act(async () => {
      await apiRef!.loadProducts(0, 10, { category: "B" });
    });
    expect(ids()).toEqual(["b1", "b2"]);

    const resultado = await exclusao.falhar({ message: "conexão perdida" });

    expect(resultado).toBe(false);
    expect(mock.toastError).toHaveBeenCalledWith("Erro ao excluir produto");
    expect(ids()).toEqual(["b1", "b2"]);
  });

  it("controle: falha sem trocar de lista continua devolvendo o produto", async () => {
    await montar();
    await act(async () => {
      await apiRef!.loadProducts(0, 10, { category: "A" });
    });
    const exclusao = await excluirSemResposta("a1");
    expect(ids()).toEqual(["a2"]);

    const resultado = await exclusao.falhar({ message: "conexão perdida" });

    expect(resultado).toBe(false);
    expect(ids()).toEqual(["a1", "a2"]);
  });

  it("troca para B ainda no ar quando a exclusão falha: a leitura de B é quem manda", async () => {
    await montar();
    await act(async () => {
      await apiRef!.loadProducts(0, 10, { category: "A" });
    });
    const exclusao = await excluirSemResposta("a1");

    mock.rpcSegurado = { categoria: "B", soltar: () => {} };
    let leituraDeB!: Promise<unknown>;
    await act(async () => {
      leituraDeB = apiRef!.loadProducts(0, 10, { category: "B" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await exclusao.falhar({ message: "conexão perdida" });
    await act(async () => {
      mock.rpcSegurado!.soltar();
      await leituraDeB;
    });

    expect(ids()).toEqual(["b1", "b2"]);
  });

  it("a cópia sem filtro (primeira tela ao reabrir) também volta com o produto", async () => {
    await montar();
    await act(async () => {
      await apiRef!.loadProducts(0, 10);
    });
    expect(ids()).toEqual(["a1", "a2", "b1"]);
    const exclusao = await excluirSemResposta("a1");
    await act(async () => {
      await apiRef!.loadProducts(0, 10, { category: "B" });
    });
    await exclusao.falhar({ message: "conexão perdida" });
    expect(ids()).toEqual(["b1", "b2"]);

    // Reabre a tela: ela desenha a cópia guardada enquanto carrega.
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar();
    expect(ids()).toEqual(["a1", "a2", "b1"]);
  });

  it("a cópia sem filtro mais nova que a exclusão não é trocada pela antiga", async () => {
    await montar();
    await act(async () => {
      await apiRef!.loadProducts(0, 10);
    });
    const exclusao = await excluirSemResposta("a1");
    // Outra leitura sem filtro chega enquanto a exclusão espera (o catálogo
    // mudou: agora há b2 e o a2 saiu).
    mock.linhasPorCategoria.all = [linha("b1", "B"), linha("b2", "B")];
    await act(async () => {
      await apiRef!.loadProducts(0, 10);
    });
    await exclusao.falhar({ message: "conexão perdida" });
    expect(ids()).toEqual(["b1", "b2"]);

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar();
    expect(ids()).toEqual(["b1", "b2"]);
  });
});
