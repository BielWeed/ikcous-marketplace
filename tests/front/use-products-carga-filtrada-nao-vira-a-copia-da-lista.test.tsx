// @vitest-environment jsdom
//
// A COPIA QUE A TELA PRODUTOS DESENHA ENQUANTO CARREGA NAO PODE SER UMA LISTA FILTRADA.
//
// `loadProducts` guarda o que leu em `cachedAdminProducts` (estado inicial da
// tela Produtos e lista de reserva sem rede). A tela de Notificacoes pede so os
// produtos ativos com estoque baixo (`stock: "low"`, `status: "active"`): se
// essa leitura sobrescrevesse a copia, a lojista que passa por Notificacoes e
// abre Produtos veria so os produtos acabando (e, sem rede, so eles e o total
// baixo). Leitura que filtra por estoque ou situacao nao vira a copia; a
// leitura sem esses filtros (inclusive com busca/categoria) continua gravando.
//
// Como se observa a copia: uma instancia NOVA do hook (`autoFetch: false`)
// nasce com ela como lista inicial.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  chamadas: [] as any[],
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
      // Servidor de mentira: filtro de estoque/situacao devolve OUTRA lista.
      const filtrada = args.p_stock !== "all" || args.p_status !== "all";
      const data = filtrada ? [linha("baixo-1")] : [linha("a"), linha("b")];
      return {
        abortSignal: async () => ({
          data: { data, total_count: data.length },
          error: null,
        }),
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

describe("useProducts.loadProducts: leitura filtrada nao sobrescreve a copia da lista", () => {
  let hospedeiros: HTMLDivElement[];
  let raizes: Root[];
  let atual: () => Api;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.chamadas = [];
    hospedeiros = [];
    raizes = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    // O efeito da fila offline agenda um timer real quando online.
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
  });

  afterEach(() => {
    for (const raiz of raizes) act(() => raiz.unmount());
    for (const h of hospedeiros) h.remove();
    vi.restoreAllMocks();
  });

  // `atual()` devolve o hook como esta AGORA (o `onReady` roda a cada render).
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

  /** O que uma tela Produtos recem-aberta desenharia antes da consulta voltar. */
  async function listaInicial() {
    const nova = await montar();
    return nova().products.map((p) => p.id);
  }

  async function ler(filtros: Record<string, unknown>) {
    atual = await montar();
    await act(async () => {
      await atual().loadProducts(0, 12, { silent: true, ...filtros });
    });
  }

  it("leitura sem filtro de estoque/situacao continua gravando a copia (inclusive com busca e categoria)", async () => {
    await ler({});
    expect(await listaInicial()).toEqual(["a", "b"]);

    await ler({ search: "x", category: "Anéis" });
    expect(mock.chamadas.at(-1)).toMatchObject({ p_search: "x" });
    expect(await listaInicial()).toEqual(["a", "b"]);
  });

  it("leitura de estoque baixo (Notificacoes) NAO sobrescreve a copia", async () => {
    await ler({});
    expect(await listaInicial()).toEqual(["a", "b"]);

    await ler({ stock: "low", status: "active" });
    expect(mock.chamadas.at(-1)).toMatchObject({
      p_stock: "low",
      p_status: "active",
    });
    // A tela recebeu a lista filtrada (o retorno nao muda)...
    expect(atual().products.map((p) => p.id)).toEqual(["baixo-1"]);
    // ...mas a copia da tela Produtos segue sendo a lista inteira.
    expect(await listaInicial()).toEqual(["a", "b"]);
  });

  it.each([{ stock: "low" }, { status: "active" }, { status: "inactive" }])(
    "filtro %j sozinho tambem nao sobrescreve a copia",
    async (filtros) => {
      await ler({});
      await ler(filtros);
      expect(await listaInicial()).toEqual(["a", "b"]);
    },
  );
});
