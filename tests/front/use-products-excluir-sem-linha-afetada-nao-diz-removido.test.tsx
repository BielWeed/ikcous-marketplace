// @vitest-environment jsdom
//
// A conta perdeu o cargo de admin em outro aparelho (rebaixada) com o painel
// ainda aberto neste. A regra de segurança do banco (RLS) barra a exclusão, mas
// o Supabase NÃO devolve erro: devolve sucesso com ZERO linhas mexidas. O hook
// olhava só o `error`, então a tela dizia "Produto removido" e o produto
// continuava à venda.
//
// Dublê fiel ao PostgREST: sem `.select()` o `await` devolve `{ data: null,
// error: null }` (nada a conferir); com `.select("id")` devolve as linhas que
// de fato foram mexidas. Quem só olha o `error` nunca vê o zero.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  fetchProductsContext: vi.fn().mockResolvedValue(undefined),
  copy: vi.fn().mockResolvedValue({ error: null }),
  escritas: [] as Array<{
    tabela: string;
    operacao: "update" | "delete";
    ids: string[];
  }>,
  /** Quem decide o que o banco devolve a cada escrita; padrão: mexeu em todas. */
  responder: null as
    | null
    | ((escrita: {
        tabela: string;
        operacao: "update" | "delete";
        ids: string[];
      }) => { data: Array<{ id: string }> | null; error: unknown }),
  linhas: [] as any[],
  variacoesNoBanco: [] as any[],
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
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

function escrever(
  tabela: string,
  operacao: "update" | "delete",
  ids: string[],
) {
  mock.escritas.push({ tabela, operacao, ids });
  const resposta = mock.responder
    ? mock.responder({ tabela, operacao, ids })
    : { data: ids.map((id) => ({ id })), error: null };
  const cadeia: any = {
    // Sem `.select()`: o PostgREST não devolve linha nenhuma.
    // biome-ignore lint/suspicious/noThenProperty: dublê do construtor do PostgREST, que é "thenable".
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: resposta.error }).then(ok, ko),
    select: () => Promise.resolve(resposta),
  };
  return cadeia;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => ({
      abortSignal: () =>
        Promise.resolve({
          data: { data: mock.linhas, total_count: mock.linhas.length },
          error: null,
        }),
    }),
    from: (tabela: string) => ({
      update: () => ({
        eq: (_coluna: string, id: string) => escrever(tabela, "update", [id]),
        in: (_coluna: string, ids: string[]) => escrever(tabela, "update", ids),
      }),
      delete: () => ({
        eq: (_coluna: string, id: string) => escrever(tabela, "delete", [id]),
      }),
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: { image_url: null },
              error: null,
            }),
        }),
        in: () => Promise.resolve({ data: mock.variacoesNoBanco, error: null }),
      }),
    }),
    storage: {
      from: () => ({ copy: mock.copy, getPublicUrl: vi.fn() }),
    },
    auth: { refreshSession: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let api: ReturnType<typeof useProducts>;
let raiz: Root;
let host: HTMLDivElement;
function Sonda() {
  const produtos = useProducts({ autoFetch: false });
  useEffect(() => {
    api = produtos;
  });
  return null;
}
const linha = (id: string) => ({
  id,
  nome: `Produto ${id}`,
  preco_venda: 10,
  estoque: 1,
  imagem_urls: [],
  ativo: true,
  product_variants: [],
});

/** O banco não mexeu em linha nenhuma, sem erro (o que o RLS faz). */
const bancoNaoMexeEmNada = () => {
  mock.responder = () => ({ data: [], error: null });
};
const idsNaLista = () => api.products.map((p) => p.id);

beforeEach(async () => {
  vi.clearAllMocks();
  mock.fetchProductsContext.mockResolvedValue(undefined);
  mock.copy.mockResolvedValue({ error: null });
  mock.escritas.length = 0;
  mock.responder = null;
  mock.linhas = [linha("p1"), linha("p2"), linha("p3")];
  mock.variacoesNoBanco = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
  await act(async () => raiz.render(<Sonda />));
  await act(async () => {
    await api.loadProducts(0, 10);
  });
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("excluir um produto", () => {
  it("o banco não mexeu em linha nenhuma: NÃO diz que removeu, o produto continua na lista e nada é relido", async () => {
    bancoNaoMexeEmNada();

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await api.deleteProduct("p1");
    });

    expect(resultado).toBe(false);
    expect(mock.toastSuccess).not.toHaveBeenCalled();
    expect(mock.toastError).toHaveBeenCalledTimes(1);
    const frase = String(mock.toastError.mock.calls[0][0]);
    expect(frase).toMatch(/não foi excluído/i);
    expect(frase).not.toMatch(/removido/i);
    expect(idsNaLista()).toEqual(["p1", "p2", "p3"]);
    expect(mock.fetchProductsContext).not.toHaveBeenCalled();
    expect(mock.copy).not.toHaveBeenCalled();
  });

  it("controle: o banco mexeu na linha, remove de verdade e diz que removeu", async () => {
    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await api.deleteProduct("p1");
    });

    expect(resultado).toBe(true);
    expect(mock.toastSuccess).toHaveBeenCalledWith("Produto removido");
    expect(mock.toastError).not.toHaveBeenCalled();
    expect(idsNaLista()).toEqual(["p2", "p3"]);
  });

  it("controle: erro explícito do banco segue como antes (aviso genérico e o produto volta)", async () => {
    mock.responder = () => ({ data: null, error: { message: "rede caiu" } });

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await api.deleteProduct("p1");
    });

    expect(resultado).toBe(false);
    expect(mock.toastError).toHaveBeenCalledWith("Erro ao excluir produto");
    expect(mock.toastSuccess).not.toHaveBeenCalled();
    expect(idsNaLista()).toEqual(["p1", "p2", "p3"]);
  });
});

describe("excluir vários produtos", () => {
  it("a conta perde a permissão no meio: o que já saiu continua fora, o resto volta e NÃO diz que removeu", async () => {
    mock.responder = ({ ids }) =>
      ids[0] === "p1"
        ? { data: [{ id: "p1" }], error: null }
        : { data: [], error: null };

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await api.deleteProducts(["p1", "p2", "p3"]);
    });

    expect(resultado).toBe(false);
    expect(mock.escritas.map((e) => e.ids[0])).toEqual(["p1", "p2"]);
    expect(idsNaLista()).toEqual(["p2", "p3"]);
    expect(mock.toastSuccess).not.toHaveBeenCalled();
    expect(mock.toastError).toHaveBeenCalledTimes(1);
    expect(String(mock.toastError.mock.calls[0][0])).toMatch(
      /não foi excluído/i,
    );
  });

  it("controle: erro explícito no meio do lote segue com o aviso genérico", async () => {
    mock.responder = ({ ids }) =>
      ids[0] === "p1"
        ? { data: [{ id: "p1" }], error: null }
        : { data: null, error: { message: "rede caiu" } };

    await act(async () => {
      await api.deleteProducts(["p1", "p2"]);
    });

    expect(mock.toastError).toHaveBeenCalledWith("Erro ao excluir produtos");
    expect(idsNaLista()).toEqual(["p2", "p3"]);
  });

  it("controle: todos saem de verdade, um aviso de sucesso", async () => {
    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await api.deleteProducts(["p1", "p2"]);
    });

    expect(resultado).toBe(true);
    expect(mock.toastSuccess).toHaveBeenCalledWith("2 produtos removidos");
    expect(idsNaLista()).toEqual(["p3"]);
  });
});

describe("pausar ou ativar vários produtos", () => {
  it("o banco não mexeu em linha nenhuma: NÃO diz 'Status atualizado' e a lista desfaz a pintura", async () => {
    bancoNaoMexeEmNada();

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await api.updateProductsStatus(["p1", "p2"], false);
    });

    expect(resultado).toBe(false);
    expect(mock.toastSuccess).not.toHaveBeenCalled();
    expect(mock.toastError).toHaveBeenCalledTimes(1);
    expect(String(mock.toastError.mock.calls[0][0])).toMatch(
      /nada foi alterado/i,
    );
    expect(api.products.every((p) => p.isActive)).toBe(true);
    expect(mock.fetchProductsContext).not.toHaveBeenCalled();
  });

  it("controle: o banco mexeu, diz 'Status atualizado'", async () => {
    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await api.updateProductsStatus(["p1", "p2"], false);
    });

    expect(resultado).toBe(true);
    expect(mock.toastSuccess).toHaveBeenCalledWith("Status atualizado");
  });
});

describe("excluir variação", () => {
  it("o banco não mexeu em linha nenhuma: falha, NÃO diz 'Variação removida' e não mexe em foto", async () => {
    bancoNaoMexeEmNada();

    await act(async () => {
      await expect(api.deleteVariant("v1")).rejects.toBeTruthy();
    });

    expect(mock.toastSuccess).not.toHaveBeenCalled();
    expect(mock.toastError).toHaveBeenCalledTimes(1);
    expect(String(mock.toastError.mock.calls[0][0])).not.toMatch(/removida/i);
    expect(mock.fetchProductsContext).not.toHaveBeenCalled();
    expect(mock.copy).not.toHaveBeenCalled();
  });

  it("controle: o banco mexeu, diz 'Variação removida'", async () => {
    await act(async () => {
      await api.deleteVariant("v1");
    });

    expect(mock.toastSuccess).toHaveBeenCalledWith("Variação removida");
  });
});

describe("excluir várias variações", () => {
  it("uma delas o banco não mexeu: ela vem em `recusadas`, a outra sai e NÃO diz 'Variações removidas'", async () => {
    mock.responder = ({ ids }) =>
      ids[0] === "v1"
        ? { data: [{ id: "v1" }], error: null }
        : { data: [], error: null };

    let erro: (Error & { recusadas?: string[] }) | undefined;
    await act(async () => {
      try {
        await api.deleteVariants(["v1", "v2"]);
      } catch (e) {
        erro = e as Error & { recusadas?: string[] };
      }
    });

    expect(erro).toBeDefined();
    expect(erro?.recusadas).toEqual(["v2"]);
    expect(mock.toastSuccess).not.toHaveBeenCalled();
    expect(mock.toastError).toHaveBeenCalledTimes(1);
    // A que saiu de verdade faz a tela reler; a recusada não é dada como apagada.
    expect(mock.fetchProductsContext).toHaveBeenCalledTimes(1);
  });

  it("controle: todas saem, um aviso de sucesso", async () => {
    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await api.deleteVariants(["v1", "v2"]);
    });

    expect(resultado).toBe(true);
    expect(mock.toastSuccess).toHaveBeenCalledWith("Variações removidas");
  });
});
