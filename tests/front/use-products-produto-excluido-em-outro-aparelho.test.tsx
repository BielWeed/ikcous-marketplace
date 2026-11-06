// @vitest-environment jsdom
//
// Produto que OUTRO aparelho já excluiu não pode "dar certo" ao pausar, ativar
// ou salvar neste.
//
// O defeito: `updateProduct` fazia UPDATE em `vw_produtos_admin` só com
// `.eq("id")`. A view não filtra `deleted_at`, então o UPDATE valia, voltava
// "Produto atualizado!" e o produto excluído ficava com `ativo = true` (e à
// mostra, por exemplo, nas recomendações da loja). Agora o UPDATE leva
// `deleted_at IS NULL`; sem linha, o app confere se o produto foi excluído e
// diz isso (nunca "o estoque mudou", que seria enganoso), e a lista desfaz a
// pintura otimista do botão.
//
// Banco dublê com a regra real: o UPDATE só altera a linha cujos filtros TODOS
// casam; sem o filtro de `deleted_at` ele altera a excluída.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  produto: {} as Record<string, any>,
  filtrosDoUpdate: [] as Array<Array<[string, unknown]>>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "lojista-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const semLinha = { code: "PGRST116", message: "no rows" };

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: (nome: string) => {
      if (nome !== "get_admin_products_paged")
        throw new Error(`RPC não mockada: ${nome}`);
      return {
        abortSignal: async () => ({
          data: { data: [structuredClone(banco.produto)], total_count: 1 },
          error: null,
        }),
      };
    },
    from: (tabela: string) => {
      if (tabela === "product_variants") {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (tabela !== "vw_produtos_admin")
        throw new Error(`Tabela inesperada: ${tabela}`);
      return {
        select: () => {
          const filtros: Array<[string, unknown]> = [];
          const ler = async () => {
            const viva = filtros.every(([campo, valor]) =>
              campo === "deleted_at"
                ? (banco.produto.deleted_at ?? null) === valor
                : banco.produto[campo] === valor,
            );
            return viva
              ? { data: structuredClone(banco.produto), error: null }
              : { data: null, error: semLinha };
          };
          const consulta = {
            eq: (campo: string, valor: unknown) => {
              filtros.push([campo, valor]);
              return consulta;
            },
            is: (campo: string, valor: unknown) => {
              filtros.push([campo, valor]);
              return consulta;
            },
            single: ler,
          };
          return consulta;
        },
        update: (patch: Record<string, unknown>) => {
          const filtros: Array<[string, unknown]> = [];
          banco.filtrosDoUpdate.push(filtros);
          const executar = async (aoNaoAcharLinha: "erro" | "nulo") => {
            const casa = filtros.every(([campo, valor]) =>
              campo === "deleted_at"
                ? (banco.produto.deleted_at ?? null) === valor
                : banco.produto[campo] === valor,
            );
            if (!casa) {
              return aoNaoAcharLinha === "erro"
                ? { data: null, error: semLinha }
                : { data: null, error: null };
            }
            Object.assign(banco.produto, patch);
            return {
              data: structuredClone({ ...banco.produto, product_variants: [] }),
              error: null,
            };
          };
          const consulta = {
            eq: (campo: string, valor: unknown) => {
              filtros.push([campo, valor]);
              return consulta;
            },
            is: (campo: string, valor: unknown) => {
              filtros.push([campo, valor]);
              return consulta;
            },
            select: () => consulta,
            single: () => executar("erro"),
            maybeSingle: () => executar("nulo"),
          };
          return consulta;
        },
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useProducts>;
let api: Api;
function Sonda() {
  const hook = useProducts({ autoFetch: false });
  useEffect(() => {
    api = hook;
  });
  return null;
}

const MSG_EXCLUIDO =
  "Este produto foi excluído em outro aparelho. Recarregue a lista.";

const produtoVivo = () => ({
  id: "p1",
  nome: "Camiseta",
  descricao: "",
  preco_venda: 50,
  custo: null,
  estoque: 3,
  ativo: false,
  categoria: "Geral",
  imagem_urls: [],
  ultima_atualizacao: "2026-11-03T10:00:00.123456+00:00",
  deleted_at: null,
});

describe("useProducts: produto excluído em outro aparelho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("navigator", { onLine: true });
    banco.produto = produtoVivo();
    banco.filtrosDoUpdate = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Sonda />);
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const excluirEmOutroAparelho = () => {
    banco.produto.deleted_at = "2026-11-03T11:00:00+00:00";
    banco.produto.ativo = false;
  };
  const erros = () =>
    vi.mocked(toast.error).mock.calls.map(([mensagem]) => String(mensagem));

  it("controle: produto vivo continua atualizando (UPDATE leva deleted_at IS NULL)", async () => {
    let resultado: unknown;
    await act(async () => {
      resultado = await api.updateProduct("p1", { isActive: true });
    });
    expect(resultado).toBeTruthy();
    expect(banco.produto.ativo).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Produto atualizado!");
    expect(banco.filtrosDoUpdate[0]).toContainEqual(["deleted_at", null]);
  });

  it("ativar produto já excluído: recusa clara, NÃO reativa e NÃO diz 'atualizado'", async () => {
    excluirEmOutroAparelho();
    let erro: unknown;
    await act(async () => {
      erro = await api.updateProduct("p1", { isActive: true }).catch((e) => e);
    });
    expect((erro as Error).message).toBe(MSG_EXCLUIDO);
    expect(erros()).toEqual([MSG_EXCLUIDO]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(banco.produto.ativo).toBe(false);
  });

  it("salvar com conferência de estoque num produto excluído: diz 'excluído', nunca 'o estoque mudou'", async () => {
    excluirEmOutroAparelho();
    let erro: unknown;
    await act(async () => {
      erro = await api
        .updateProduct(
          "p1",
          { stock: 9 },
          { baseUpdatedAt: "2026-11-03T10:00:00.123456+00:00" },
        )
        .catch((e) => e);
    });
    expect((erro as Error).message).toBe(MSG_EXCLUIDO);
    expect(erros()).toEqual([MSG_EXCLUIDO]);
    expect(erros().join(" ")).not.toContain("estoque");
    expect(banco.produto.stock).toBeUndefined();
  });

  it("limite: o produto mudou DE VERDADE (produto vivo, versão nova) diz que foi alterado em outro aparelho (estoque ou fotos)", async () => {
    banco.produto.ultima_atualizacao = "2026-11-03T10:30:00+00:00";
    let erro: unknown;
    await act(async () => {
      erro = await api
        .updateProduct(
          "p1",
          { stock: 9 },
          { baseUpdatedAt: "2026-11-03T10:00:00.123456+00:00" },
        )
        .catch((e) => e);
    });
    expect((erro as Error).message).toContain(
      "Este produto foi alterado em outro aparelho enquanto você editava (estoque ou fotos). Os dados foram recarregados; confira e salve de novo.",
    );
    expect(erros()[0]).not.toContain("excluído");
  });

  it("pausar/ativar pela lista de um produto excluído: recusa clara e a lista DESFAZ a pintura otimista", async () => {
    await act(async () => {
      await api.loadProducts(0, 10);
    });
    expect(api.products.find((p) => p.id === "p1")?.isActive).toBe(false);

    excluirEmOutroAparelho();
    let erro: unknown;
    await act(async () => {
      erro = await api.toggleProductStatus("p1", false).catch((e) => e);
    });

    expect((erro as Error).message).toBe(MSG_EXCLUIDO);
    expect(erros()).toEqual([MSG_EXCLUIDO]);
    // Pintou "ativo" antes de perguntar ao banco; ao recusar, volta ao que era.
    expect(api.products.find((p) => p.id === "p1")?.isActive).toBe(false);
    expect(banco.produto.ativo).toBe(false);
  });
});
