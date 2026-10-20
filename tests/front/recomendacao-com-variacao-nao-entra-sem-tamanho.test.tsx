import type { Product } from "@/types";
// @vitest-environment jsdom
//
// "Você também pode gostar" (página de produto) levava peça com tamanho/cor
// para o carrinho SEM escolha (medido no ar em 14/10/2026). A função do banco
// `get_product_recommendations` devolve `SETOF produtos` — sem as variações —,
// o front montava o produto com `variants: []` e a trava do card
// (`hasActiveVariant`) não via nada para travar: botão "Carrinho", peça no
// carrinho sem variação, e só no pagamento o servidor recusava ("Escolha uma
// variação para o produto X").
//
// Aqui o buscador REAL (`fetchRecommendations`, dentro do `useProducts`) é
// alimentado por um Supabase simulado que devolve a linha da função (sem
// variações) e as variações da tabela, e o card REAL (`ProductCard`) recebe o
// que o buscador devolveu — o mesmo caminho da faixa da página de produto.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  linhasDaFuncao: [] as Record<string, unknown>[],
  variacoes: [] as Record<string, unknown>[],
  // "ok" | "erro" (o banco responde com erro) | "rejeita" (a rede cai).
  leituraDeVariacoes: "ok" as "ok" | "erro" | "rejeita" | "nulo",
  consultasDeVariacao: [] as { coluna: string; ids: string[] }[],
  chamadasDaFuncao: 0,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    message: vi.fn(),
    custom: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) => {
      if (nome !== "get_product_recommendations") {
        throw new Error(`rpc inesperada: ${nome}`);
      }
      mock.chamadasDaFuncao += 1;
      return Promise.resolve({ data: mock.linhasDaFuncao, error: null });
    },
    from: (tabela: string) => {
      if (tabela !== "product_variants") {
        throw new Error(`tabela inesperada: ${tabela}`);
      }
      return {
        select: () => ({
          in: (coluna: string, ids: string[]) => {
            mock.consultasDeVariacao.push({ coluna, ids });
            if (mock.leituraDeVariacoes === "rejeita") {
              return Promise.reject(new Error("rede caiu"));
            }
            if (mock.leituraDeVariacoes === "erro") {
              return Promise.resolve({
                data: null,
                error: { message: "permission denied" },
              });
            }
            if (mock.leituraDeVariacoes === "nulo") {
              return Promise.resolve({ data: null, error: null });
            }
            return Promise.resolve({
              data: mock.variacoes.filter((v) =>
                ids.includes(v.product_id as string),
              ),
              error: null,
            });
          },
        }),
      };
    },
    auth: {
      refreshSession: vi.fn(),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Linha no formato EXATO de get_product_recommendations (RETURNS SETOF
// public.produtos): nenhuma chave `product_variants`.
const linhaDaFuncao = (id: string, nome: string): Record<string, unknown> => ({
  id,
  nome,
  descricao: "x",
  categoria: "Vestidos",
  codigo: `C-${id}`,
  custo: null,
  preco_venda: 129.9,
  estoque: 2,
  estoque_minimo: 0,
  fornecedor_id: null,
  ativo: true,
  tags: [],
  data_cadastro: "2026-10-01T00:00:00Z",
  ultima_atualizacao: "2026-10-01T00:00:00Z",
  imagem_url: "https://example.com/v.png",
  meta_title: null,
  meta_description: null,
  imagem_urls: ["https://example.com/v.png"],
  preco_original: null,
  is_bestseller: false,
  frete_gratis: false,
  sold: 0,
  deleted_at: null,
  calculated_points: 0,
  rating: 0,
  review_count: 0,
  peso_kg: null,
  largura_cm: null,
  altura_cm: null,
  comprimento_cm: null,
  codigo_barras: null,
});

const variacao = (
  id: string,
  produto: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  product_id: produto,
  name: "Tamanho",
  value: id,
  stock_increment: 1,
  active: true,
  price_override: null,
  sku: null,
  codigo_barras: null,
  ...extra,
});

let hospedeiro: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  mock.linhasDaFuncao = [];
  mock.variacoes = [];
  mock.leituraDeVariacoes = "ok";
  mock.consultasDeVariacao = [];
  mock.chamadasDaFuncao = 0;
  vi.stubGlobal("ResizeObserver", ObservadorFalso);
  vi.stubGlobal("IntersectionObserver", ObservadorFalso);
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** O buscador REAL do `useProducts`, sem render de tela. */
async function buscarRecomendacoes(
  produtoDaPagina = "pagina",
): Promise<Product[]> {
  const { useProducts } = await import("@/hooks/useProducts");
  let api: ReturnType<typeof useProducts> | undefined;
  function Sonda() {
    const retorno = useProducts({ autoFetch: false });
    useEffect(() => {
      api = retorno;
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
  let recs: Product[] = [];
  await act(async () => {
    recs = await api!.fetchRecommendations(produtoDaPagina);
  });
  act(() => {
    raiz.render(null);
  });
  return recs;
}

/** O card REAL, como a faixa da página de produto o monta, e um toque no botão. */
async function tocarNoCardDe(produto: Product) {
  const { ProductCard } = await import("@/components/ui/custom/ProductCard");
  const espioes = {
    onClick: vi.fn(),
    onAddToCart: vi.fn(),
    onAddToCartWithVariants: vi.fn(),
    onQuickBuy: vi.fn(),
  };
  await act(async () => {
    raiz.render(
      <ProductCard
        product={produto}
        isFavorite={false}
        onToggleFavorite={() => {}}
        onClick={espioes.onClick}
        showRating={false}
        onAddToCart={espioes.onAddToCart}
        onAddToCartWithVariants={espioes.onAddToCartWithVariants}
        onQuickBuy={espioes.onQuickBuy}
      />,
    );
  });
  const botao = hospedeiro.querySelector<HTMLButtonElement>(
    "button[data-testid=product-card-action]",
  );
  const rotulo = (botao?.textContent ?? "").trim();
  await act(async () => {
    botao?.click();
  });
  return {
    rotulo,
    espioes,
    abriuFolhaDeOpcoes:
      document.querySelector("[data-testid=product-card-options-sheet]") !==
      null,
  };
}

describe("faixa 'Você também pode gostar': peça com variação não entra sem escolha", () => {
  it("buscador junta as variações da tabela; o card pede 'Escolher opções' e NÃO adiciona direto", async () => {
    mock.linhasDaFuncao = [linhaDaFuncao("vestido", "Vestido Midi")];
    mock.variacoes = [variacao("P", "vestido"), variacao("M", "vestido")];

    const [produto] = await buscarRecomendacoes();
    expect(produto.variants?.map((v) => v.id)).toEqual(["P", "M"]);

    const r = await tocarNoCardDe(produto);
    expect(r.rotulo).toBe("Escolher opções");
    expect(r.espioes.onAddToCart).not.toHaveBeenCalled();
    expect(r.abriuFolhaDeOpcoes).toBe(true);
  });

  it("uma consulta só para todos os produtos da faixa, cada um com as SUAS variações", async () => {
    mock.linhasDaFuncao = [
      linhaDaFuncao("vestido", "Vestido Midi"),
      linhaDaFuncao("bolsa", "Bolsa"),
    ];
    mock.variacoes = [
      variacao("P", "vestido"),
      variacao("M", "vestido"),
      variacao("outra", "nao-esta-na-faixa"),
    ];

    const recs = await buscarRecomendacoes();

    expect(mock.consultasDeVariacao).toEqual([
      { coluna: "product_id", ids: ["vestido", "bolsa"] },
    ]);
    const porId = new Map(recs.map((p) => [p.id, p]));
    expect(porId.get("vestido")?.variants?.map((v) => v.id)).toEqual([
      "P",
      "M",
    ]);
    expect(porId.get("bolsa")?.variants).toEqual([]);
  });

  it("produto SEM variação segue intacto: botão 'Carrinho' e adiciona direto", async () => {
    mock.linhasDaFuncao = [linhaDaFuncao("bolsa", "Bolsa")];
    mock.variacoes = [];

    const [produto] = await buscarRecomendacoes();
    expect(produto.variantsUnavailable).toBeUndefined();

    const r = await tocarNoCardDe(produto);
    expect(r.rotulo).toBe("Carrinho");
    expect(r.espioes.onAddToCart).toHaveBeenCalledTimes(1);
    expect(r.espioes.onClick).not.toHaveBeenCalled();
  });

  it("produto com variações TODAS desativadas segue vendável pelo produto base (mesma regra do servidor)", async () => {
    mock.linhasDaFuncao = [linhaDaFuncao("bolsa", "Bolsa")];
    mock.variacoes = [variacao("velha", "bolsa", { active: false })];

    const [produto] = await buscarRecomendacoes();

    const r = await tocarNoCardDe(produto);
    expect(r.rotulo).toBe("Carrinho");
    expect(r.espioes.onAddToCart).toHaveBeenCalledTimes(1);
  });

  it("a função sem nenhuma linha: nenhuma consulta de variações", async () => {
    mock.linhasDaFuncao = [];
    const recs = await buscarRecomendacoes();
    expect(recs).toEqual([]);
    expect(mock.consultasDeVariacao).toEqual([]);
  });
});

describe("leitura das variações FALHOU: falha fechado (a peça abre a página, nunca vai direto)", () => {
  it.each([
    ["o banco responde com erro", "erro"],
    ["a rede cai no meio", "rejeita"],
    ["a resposta vem sem dados e sem erro", "nulo"],
  ] as const)("%s", async (_nome, modo) => {
    mock.linhasDaFuncao = [linhaDaFuncao("vestido", "Vestido Midi")];
    mock.variacoes = [variacao("P", "vestido")];
    mock.leituraDeVariacoes = modo;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const recs = await buscarRecomendacoes();
    expect(recs).toHaveLength(1);
    expect(recs[0].variantsUnavailable).toBe(true);

    const r = await tocarNoCardDe(recs[0]);
    expect(r.espioes.onAddToCart).not.toHaveBeenCalled();
    expect(r.espioes.onAddToCartWithVariants).not.toHaveBeenCalled();
    expect(r.espioes.onClick).toHaveBeenCalledWith("vestido");
    expect(r.rotulo).toBe("Ver produto");
  });
});

describe("cache da faixa no aparelho: nada de cópia antiga sem variação, nada de resposta degradada", () => {
  const CHAVE_NOVA = "ikcous_recs_v2_cache_pagina";
  const CHAVE_ANTIGA = "ikcous_recs_cache_pagina";

  const produtoSemVariacao = (extra: Partial<Product> = {}) =>
    ({
      id: "vestido",
      name: "Vestido Midi",
      price: 129.9,
      stock: 2,
      images: [],
      variants: [],
      ...extra,
    }) as unknown as Product;

  async function montarHook(buscar: (id: string) => Promise<Product[]>) {
    vi.resetModules();
    const { useRecomendacoesDeProduto } = await import(
      "@/hooks/useRecomendacoesDeProduto"
    );
    const vistos: Product[][] = [];
    function Sonda() {
      const { recomendacoes } = useRecomendacoesDeProduto(
        "pagina",
        true,
        buscar,
      );
      vistos.push(recomendacoes);
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
    return vistos;
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it("cópia gravada por versão antiga (chave velha, sem variação) NÃO é servida", async () => {
    localStorage.setItem(
      CHAVE_ANTIGA,
      JSON.stringify([produtoSemVariacao({ id: "copia-velha" })]),
    );
    const vistos = await montarHook(async () => []);
    expect(vistos[0]).toEqual([]);
    expect(JSON.stringify(vistos)).not.toContain("copia-velha");
  });

  it("resposta boa é gravada na chave nova", async () => {
    await montarHook(async () => [produtoSemVariacao()]);
    expect(localStorage.getItem(CHAVE_NOVA)).toContain("vestido");
  });

  it("resposta com a leitura de variações falha NÃO é gravada (a próxima visita busca de novo)", async () => {
    await montarHook(async () => [
      produtoSemVariacao({ variantsUnavailable: true }),
    ]);
    expect(localStorage.getItem(CHAVE_NOVA)).toBeNull();
    expect(localStorage.getItem(CHAVE_ANTIGA)).toBeNull();
  });
});
