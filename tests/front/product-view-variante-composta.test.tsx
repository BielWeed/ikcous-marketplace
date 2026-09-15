// @vitest-environment jsdom
//
// O LADO CLIENTE da variante composta (peça 19): a combinação "Branca / PP"
// criada pelo lojista tem de chegar aqui como opção selecionável do MESMO
// produto, com o estoque DELA e o preço DELA — e a compra tem de levar o
// variant_id da combinação certa, que é o que o servidor baixa do estoque.
//
// Prova de MENOR INVASÃO: este teste EXIGE que `ProductView` não precise de
// nenhuma mudança — ele renderiza a lista plana de variantes agrupando por
// `name`; a linha composta (name="Cor / Tamanho", value="Branca / PP") já
// vira um grupo com um botão por combinação. O desenho está em
// `src/utils/variante-composta.ts`; a tela do cliente é território da
// peça 18 e está intocada.
//
// Modelo estrutural copiado de product-view-estoque-contraste-aa.test.tsx
// (mesmos dublês e stubs de jsdom).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: vi.fn(),
    markHelpful: vi.fn(),
    subscribeToReviews: vi.fn(() => () => {}),
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}));

vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
  }),
}));

// jsdom não implementa IntersectionObserver -- o efeito de recomendações do
// ProductView cria um a cada montagem.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const blusaBrancaPP = {
  id: "v-pp",
  productId: "p-blusa",
  name: "Cor / Tamanho",
  value: "Branca / PP",
  stockIncrement: 3,
  priceOverride: 25,
  active: true,
};

const blusaBrancaP = {
  id: "v-p",
  productId: "p-blusa",
  name: "Cor / Tamanho",
  value: "Branca / P",
  stockIncrement: 10,
  priceOverride: 22,
  active: true,
};

const blusa: Product = {
  id: "p-blusa",
  name: "Blusa de Frio",
  description: "Descrição de teste",
  price: 30,
  images: [],
  category: "geral",
  stock: 13,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  variants: [blusaBrancaPP, blusaBrancaP],
};

function botaoPorTexto(raiz: ParentNode, texto: string) {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

/** O botão da combinação pelo valor EXATO — por includes, "Branca / P"
 *  casaria com o botão "Branca / PP" primeiro (o valor mora num span próprio
 *  dentro do botão). */
function botaoDaCombinacao(raiz: ParentNode, valor: string) {
  const span = [...raiz.querySelectorAll("button span")].find(
    (el) => el.textContent === valor,
  );
  return span?.closest("button") as HTMLButtonElement | undefined;
}

describe("ProductView — a combinação de atributos vira UMA opção com estoque próprio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let adicionarAoCarrinho: ReturnType<
    typeof vi.fn<
      (quantity: number, variantId?: string, variantNames?: string) => void
    >
  >;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    adicionarAoCarrinho = vi.fn<(q: number, v?: string, n?: string) => void>();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.unstubAllGlobals();
  });

  async function montar() {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={blusa}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={adicionarAoCarrinho}
          onBack={() => {}}
        />,
      );
    });
  }

  it("um grupo só, um botão por combinação, estoque de cada uma no botão", async () => {
    await montar();

    // A variante composta é UM grupo ("Selecione Cor / Tamanho") — não dois.
    const rotulosDeGrupo = [...hospedeiro.querySelectorAll("span")].filter(
      (el) => el.textContent?.startsWith("Selecione "),
    );
    expect(rotulosDeGrupo.map((el) => el.textContent)).toEqual([
      "Selecione Cor / Tamanho",
    ]);

    // Cada combinação é um botão com o ESTOQUE DELA.
    const botaoPP = botaoDaCombinacao(hospedeiro, "Branca / PP");
    const botaoP = botaoDaCombinacao(hospedeiro, "Branca / P");
    expect(botaoPP).toBeDefined();
    expect(botaoPP?.textContent).toContain("(3 un.)");
    expect(botaoP).toBeDefined();
    expect(botaoP?.textContent).toContain("(10 un.)");
  });

  it("escolher a branca PP mostra o estoque e o preço DA COMBINAÇÃO", async () => {
    await montar();

    await act(async () => {
      botaoDaCombinacao(hospedeiro, "Branca / PP")?.click();
    });

    // 3 unidades: rótulo de estoque baixo com o número da PP.
    expect(hospedeiro.textContent).toContain("Apenas 3 restam!");
    // O price_override da linha PP (25) vence o preço do produto (30).
    expect(hospedeiro.textContent).toContain("R$ 25,00");
  });

  it("comprar a branca PP leva o variant_id da combinação certa ao carrinho", async () => {
    await montar();

    await act(async () => {
      botaoDaCombinacao(hospedeiro, "Branca / PP")?.click();
    });
    const botaoComprar = botaoPorTexto(hospedeiro, "Adicionar ao Carrinho");
    expect(botaoComprar).toBeDefined();
    await act(async () => {
      botaoComprar?.click();
    });

    expect(adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    const [quantidade, variantId, nomes] = adicionarAoCarrinho.mock.calls[0];
    expect(quantidade).toBe(1);
    // É o id da LINHA branca PP — é dele que o servidor baixa o estoque.
    expect(variantId).toBe("v-pp");
    expect(nomes).toBe("Cor / Tamanho: Branca / PP");
  });
});
