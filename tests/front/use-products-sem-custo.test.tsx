// @vitest-environment jsdom
//
// `loadProductsSemCusto` (src/hooks/useProducts.ts) monta a lista "Sem custo"
// da tela Produtos: a lista do painel é paginada no SERVIDOR (12 por página) e
// a RPC `get_admin_products_paged` não tem filtro de custo, então a única forma
// de a lista ser COMPLETA (e bater com o número do selo, que vem do banco para
// o catálogo inteiro) é percorrer todas as páginas dos produtos ativos e
// filtrar aqui, com a regra do selo (`produtoSemCustoEmEstoque`).
//
// Hook isolado, mapper REAL (a regra depende de como custo e estoque são
// lidos da linha), RPC dublada que respeita `p_page`/`p_page_size` e registra
// cada chamada.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  toastError: vi.fn(),
  linhas: [] as any[],
  chamadas: [] as any[],
  erro: null as null | { message: string; status: number },
  /** A partir de qual página (0 = todas) a RPC devolve `erro`. */
  erroDesdeAPagina: 0,
  /** Se definido, a RPC espera esta promessa antes de responder. */
  segura: null as null | Promise<void>,
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: mock.toastError, loading: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, args: any) => {
      if (nome !== "get_admin_products_paged") {
        throw new Error(`RPC não mockada neste teste: ${nome}`);
      }
      mock.chamadas.push(args);
      return {
        abortSignal: async () => {
          if (mock.segura) await mock.segura;
          if (mock.erro && args.p_page >= mock.erroDesdeAPagina) {
            return { data: null, error: mock.erro };
          }
          const de = args.p_page * args.p_page_size;
          return {
            data: {
              data: mock.linhas.slice(de, de + args.p_page_size),
              total_count: mock.linhas.length,
            },
            error: null,
          };
        },
      };
    },
    auth: { refreshSession: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useProducts>;

function Sonda({ onReady }: { onReady: (api: Api) => void }) {
  const api = useProducts({ autoFetch: false });
  useEffect(() => {
    onReady(api);
  });
  return null;
}

const produto = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `p${n}`,
  nome: `Produto ${n}`,
  preco_venda: 10,
  estoque: 2,
  ativo: true,
  custo: null,
  product_variants: [],
  ...extra,
});

describe("useProducts.loadProductsSemCusto: lista completa, mesma regra do selo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let api: Api;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.linhas = [];
    mock.chamadas = [];
    mock.erro = null;
    mock.erroDesdeAPagina = 0;
    mock.segura = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
    // O efeito da fila offline agenda um timer real quando online.
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montar() {
    await act(async () => {
      raiz.render(<Sonda onReady={(a) => (api = a)} />);
    });
  }

  it("junta SÓ os sem custo (custo 0, com custo e sem estoque ficam de fora)", async () => {
    mock.linhas = [
      produto(1), // sem custo, com estoque: entra
      produto(2, { custo: 0 }), // brinde de custo zero: NÃO entra
      produto(3, { custo: 7.5 }), // com custo: não entra
      produto(4, { estoque: 0 }), // sem custo mas sem estoque: não entra
      produto(5, { estoque: 0, product_variants: [variacao(5, 3)] }), // estoque está na grade: entra
    ];
    await montar();
    const r = await api.loadProductsSemCusto();
    expect(r?.products.map((p) => p.id)).toEqual(["p1", "p5"]);
    expect(r?.total).toBe(2);
  });

  it("percorre TODAS as páginas: um sem custo na página 2 não fica de fora", async () => {
    // 450 produtos com custo + 2 sem custo, um em cada ponta do catálogo.
    mock.linhas = Array.from({ length: 450 }, (_, i) =>
      produto(i, { custo: 1 }),
    );
    mock.linhas[0] = produto(0);
    mock.linhas[449] = produto(449);
    await montar();
    const r = await api.loadProductsSemCusto();
    expect(r?.products.map((p) => p.id)).toEqual(["p0", "p449"]);
    // Só produtos ativos e 3 páginas, em sequência, sem pular nenhuma.
    expect(mock.chamadas.map((c) => c.p_page)).toEqual([0, 1, 2]);
    expect(mock.chamadas.every((c) => c.p_status === "active")).toBe(true);
    expect(mock.chamadas.every((c) => c.p_stock === "all")).toBe(true);
  });

  it("linha repetida entre páginas (cadastro no meio da leitura) não duplica", async () => {
    mock.linhas = Array.from({ length: 205 }, (_, i) =>
      produto(i, { custo: 1 }),
    );
    // O mesmo produto sem custo aparece no fim da página 0 e no começo da 1.
    mock.linhas[199] = produto(900);
    mock.linhas[200] = produto(900);
    await montar();
    const r = await api.loadProductsSemCusto();
    expect(r?.products.map((p) => p.id)).toEqual(["p900"]);
  });

  it("catálogo vazio devolve lista vazia, não erro", async () => {
    await montar();
    const r = await api.loadProductsSemCusto();
    expect(r).toEqual({ products: [], total: 0 });
    expect(mock.toastError).not.toHaveBeenCalled();
  });

  it("repassa busca e categoria para a consulta, sem perder o filtro de ativos", async () => {
    mock.linhas = [produto(1)];
    await montar();
    await api.loadProductsSemCusto({ search: "caneca", category: "Casa" });
    expect(mock.chamadas[0]).toMatchObject({
      p_search: "caneca",
      p_category: "Casa",
      p_status: "active",
    });
  });

  it("não troca a lista da página (products) nem o total do catálogo", async () => {
    mock.linhas = [produto(1)];
    await montar();
    const antes = api.products;
    await act(async () => {
      await api.loadProductsSemCusto();
    });
    expect(api.products).toBe(antes);
  });

  it("falha do servidor devolve null e avisa — nunca uma lista parcial como se fosse completa", async () => {
    mock.linhas = [produto(1)];
    mock.erro = { message: "boom", status: 400 };
    await montar();
    const r = await api.loadProductsSemCusto();
    expect(r).toBeNull();
    expect(mock.toastError).toHaveBeenCalledWith("Erro ao listar produtos");
  });

  it("falha na 2ª página descarta o que já tinha lido da 1ª (null, não lista pela metade)", async () => {
    mock.linhas = Array.from({ length: 300 }, (_, i) => produto(i));
    await montar();
    // A 1ª página responde; a 2ª quebra.
    mock.erro = { message: "boom", status: 400 };
    mock.erroDesdeAPagina = 1;
    const r = await api.loadProductsSemCusto();
    expect(mock.chamadas.map((c) => c.p_page)).toEqual([0, 1]);
    expect(r).toBeNull();
  });

  it("chamada concorrente: a resposta da busca antiga é descartada (null)", async () => {
    mock.linhas = [produto(1)];
    await montar();
    let liberar!: () => void;
    mock.segura = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    let primeira!: Promise<unknown>;
    let segunda!: Promise<unknown>;
    await act(async () => {
      primeira = api.loadProductsSemCusto({ search: "a" });
      segunda = api.loadProductsSemCusto({ search: "b" });
      liberar();
      await Promise.all([primeira, segunda]);
    });
    expect(await primeira).toBeNull();
    expect(await segunda).toMatchObject({ total: 1 });
  });
});

function variacao(n: number, estoque: number, ativa = true) {
  return {
    id: `v${n}`,
    product_id: `p${n}`,
    name: "Cor",
    value: "Azul",
    stock_increment: estoque,
    price_override: null,
    active: ativa,
  };
}
