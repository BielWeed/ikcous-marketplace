// @vitest-environment jsdom
//
// Caça de provas fracas por mutação, território "lista de produtos do painel":
// `useProducts.loadProducts` (a leitura paginada que a tela Produtos faz) tinha
// três limites sem prova:
//
//   (1) leitura com BUSCA ou com CATEGORIA não vira a cópia que a tela desenha
//       ao abrir (o teste vizinho `use-products-carga-filtrada-nao-vira-a-copia`
//       usa um servidor de mentira que devolve a MESMA lista com ou sem busca,
//       então não enxerga a cópia ser sobrescrita);
//   (2) sem filtro nenhum, o que vai ao servidor é exatamente "tudo": busca "",
//       categoria "all", situação "all", estoque "all", e a página/tamanho
//       pedidos;
//   (3) o total vem como NÚMERO mesmo quando o banco o devolve em texto, e
//       resposta sem total ou sem linhas vira 0 / lista vazia (nunca NaN).
//
// Como se observa a cópia: uma instância NOVA do hook (`autoFetch: false`)
// nasce com ela como lista inicial.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  chamadas: [] as any[],
  resposta: ((_args: any) => null) as (args: any) => any,
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
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

const linha = (id: string) => ({
  id,
  nome: `Produto ${id}`,
  preco_venda: 10,
  estoque: 2,
  ativo: true,
  custo: 1,
  product_variants: [],
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, args: any) => {
      if (nome !== "get_admin_products_paged") {
        throw new Error(`RPC não mockada neste teste: ${nome}`);
      }
      mock.chamadas.push(args);
      return {
        abortSignal: async () => ({ data: mock.resposta(args), error: null }),
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

/** Servidor de mentira: a lista muda conforme a busca e a categoria pedidas. */
function servidorPorFiltro(args: any) {
  const ids =
    args.p_search !== ""
      ? ["da-busca"]
      : args.p_category !== "all"
        ? ["da-categoria"]
        : ["a", "b"];
  return { data: ids.map(linha), total_count: ids.length };
}

describe("useProducts.loadProducts: busca, categoria e total", () => {
  let hospedeiros: HTMLDivElement[];
  let raizes: Root[];

  beforeEach(() => {
    vi.clearAllMocks();
    mock.chamadas = [];
    mock.resposta = servidorPorFiltro;
    hospedeiros = [];
    raizes = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    // O efeito da fila offline agenda um timer real quando online.
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
  });

  afterEach(() => {
    for (const raiz of raizes) act(() => raiz.unmount());
    for (const hospedeiro of hospedeiros) hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montar(): Promise<() => Api> {
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    hospedeiros.push(hospedeiro);
    const raiz = createRoot(hospedeiro);
    raizes.push(raiz);
    let lida!: Api;
    await act(async () => {
      raiz.render(<Sonda onReady={(a) => (lida = a)} />);
    });
    return () => lida;
  }

  async function listaInicial() {
    const nova = await montar();
    return nova().products.map((p) => p.id);
  }

  async function ler(
    filtros: Record<string, unknown>,
    pagina = 0,
    tamanho = 12,
  ) {
    const atual = await montar();
    let resultado: Awaited<ReturnType<Api["loadProducts"]>> | undefined;
    await act(async () => {
      resultado = await atual().loadProducts(pagina, tamanho, {
        silent: true,
        ...filtros,
      });
    });
    return { atual, resultado };
  }

  describe("(1) a cópia da tela é a lista SEM filtro", () => {
    it("uma leitura com BUSCA mostra o resultado, mas não vira a cópia", async () => {
      await ler({});
      expect(await listaInicial()).toEqual(["a", "b"]);

      const { atual } = await ler({ search: "anel" });
      expect(atual().products.map((p) => p.id)).toEqual(["da-busca"]);
      expect(await listaInicial()).toEqual(["a", "b"]);
    });

    it("uma leitura com CATEGORIA mostra o resultado, mas não vira a cópia", async () => {
      await ler({});
      expect(await listaInicial()).toEqual(["a", "b"]);

      const { atual } = await ler({ category: "Anéis" });
      expect(atual().products.map((p) => p.id)).toEqual(["da-categoria"]);
      expect(await listaInicial()).toEqual(["a", "b"]);
    });

    it("categoria 'all' é leitura sem filtro: vira a cópia", async () => {
      mock.resposta = (args) => ({
        data: [linha(args.p_category === "all" ? "todos" : "outro")],
        total_count: 1,
      });
      await ler({ category: "all" });
      expect(await listaInicial()).toEqual(["todos"]);
    });
  });

  describe("(2) o que vai ao servidor", () => {
    it("sem filtro: busca vazia, categoria/situação/estoque 'all' e a página pedida", async () => {
      await ler({}, 3, 24);
      expect(mock.chamadas.at(-1)).toEqual({
        p_search: "",
        p_category: "all",
        p_status: "all",
        p_stock: "all",
        p_page: 3,
        p_page_size: 24,
      });
    });

    it("com filtros: repassa busca, categoria, situação e estoque como vieram", async () => {
      await ler({
        search: "anel",
        category: "Anéis",
        status: "active",
        stock: "low",
      });
      expect(mock.chamadas.at(-1)).toMatchObject({
        p_search: "anel",
        p_category: "Anéis",
        p_status: "active",
        p_stock: "low",
      });
    });
  });

  describe("(3) o total", () => {
    it("total em texto vira número", async () => {
      mock.resposta = () => ({ data: [linha("a")], total_count: "25" });
      const { resultado } = await ler({});
      expect(resultado?.total).toBe(25);
    });

    it("sem total_count na resposta o total é 0 (nunca NaN) e a lista vem", async () => {
      mock.resposta = () => ({ data: [linha("a")] });
      const { resultado } = await ler({});
      expect(resultado?.total).toBe(0);
      expect(resultado?.products.map((p) => p.id)).toEqual(["a"]);
    });

    it("resposta com data nula vira lista vazia com o total informado", async () => {
      mock.resposta = () => ({ data: null, total_count: 0 });
      const { resultado } = await ler({});
      expect(resultado).toEqual({ products: [], total: 0 });
    });
  });
});
