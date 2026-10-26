// @vitest-environment jsdom
//
// O LADO CLIENTE da variante composta (peça 19): a combinação "Branca / PP"
// criada pelo lojista tem de chegar aqui como opção selecionável do MESMO
// produto, com o estoque DELA e o preço DELA — e a compra tem de levar o
// variant_id da combinação certa, que é o que o servidor baixa do estoque.
//
// O redesenho separa a escolha em Tamanho e Cor (o tamanho primeiro, mesmo no
// produto gravado como "Cor / Tamanho"), mas preserva o contrato:
// só a combinação completa entrega o MESMO id, estoque, preço e rótulo cru.
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
  const tamanho = valor.split(" / ")[1];
  return [...raiz.querySelectorAll("button")].find(
    (el) => el.getAttribute("aria-label") === tamanho,
  ) as HTMLButtonElement | undefined;
}

async function escolherBrancaPP(raiz: ParentNode) {
  await act(async () => {
    (
      raiz.querySelector('button[aria-label="Branca"]') as HTMLButtonElement
    )?.click();
  });
  await act(async () => {
    botaoDaCombinacao(raiz, "Branca / PP")?.click();
  });
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

  async function montar(produto: Product = blusa) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={adicionarAoCarrinho}
          onBack={() => {}}
        />,
      );
    });
  }

  it("duas fileiras por dimensão sem perder as opções da combinação", async () => {
    await montar();

    const grupos = [
      ...hospedeiro.querySelectorAll('[role="group"][aria-labelledby]'),
    ];
    expect(
      grupos.map(
        (el) =>
          document.getElementById(el.getAttribute("aria-labelledby") ?? "")
            ?.textContent,
      ),
    ).toEqual(["Tamanho", "Cor"]);
    expect(
      hospedeiro.querySelector('button[aria-label="Branca"]'),
    ).not.toBeNull();
    expect(botaoDaCombinacao(hospedeiro, "Branca / PP")).toBeDefined();
    expect(botaoDaCombinacao(hospedeiro, "Branca / P")).toBeDefined();
  });

  it("escolher a branca PP mostra o estoque e o preço DA COMBINAÇÃO", async () => {
    await montar();

    await escolherBrancaPP(hospedeiro);

    // 3 unidades: rótulo de estoque baixo com o número da PP.
    expect(hospedeiro.textContent).toContain("Restam apenas 3!");
    // O price_override da linha PP (25) vence o preço do produto (30).
    expect(hospedeiro.textContent).toContain("R$ 25,00");
  });

  it("comprar a branca PP leva o variant_id da combinação certa ao carrinho", async () => {
    await montar();

    await escolherBrancaPP(hospedeiro);
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

  it("o tamanho vem primeiro: escolhido o PP, a cor que só existe em outro tamanho fica apagada mas tocável, e a esgotada de vez fica travada", async () => {
    const preta = {
      ...blusaBrancaP,
      id: "v-preta-p",
      value: "Preta / P",
      stockIncrement: 4,
    };
    const roxa = {
      ...blusaBrancaP,
      id: "v-roxa-pp",
      value: "Roxa / PP",
      stockIncrement: 0,
    };
    await montar({ ...blusa, variants: [blusaBrancaPP, preta, roxa] });
    const botao = (rotulo: string) =>
      hospedeiro.querySelector(
        `button[aria-label="${rotulo}"]`,
      ) as HTMLButtonElement;
    const tocar = (rotulo: string) =>
      act(async () => {
        botao(rotulo).click();
      });

    await tocar("PP");
    expect(botao("Preta").disabled).toBe(false);
    expect(botao("Preta").classList.contains("line-through")).toBe(true);
    expect(botao("Branca").classList.contains("line-through")).toBe(false);
    // Esgotada em todo tamanho: continua desabilitada e o toque não faz nada.
    expect(botao("Roxa").disabled).toBe(true);
    await tocar("Roxa");
    expect(botao("Roxa").getAttribute("aria-pressed")).toBe("false");
    expect(botao("PP").getAttribute("aria-pressed")).toBe("true");

    // Tocar na Preta (só existe no P) escolhe a Preta e solta o PP.
    await tocar("Preta");
    expect(botao("Preta").getAttribute("aria-pressed")).toBe("true");
    expect(botao("PP").getAttribute("aria-pressed")).toBe("false");
    // Sem tamanho a compra não vai: falta escolher.
    await act(async () => {
      botaoPorTexto(hospedeiro, "Adicionar ao Carrinho")?.click();
    });
    expect(adicionarAoCarrinho).not.toHaveBeenCalled();

    await tocar("Branca");
    await tocar("PP");
    await act(async () => {
      botaoPorTexto(hospedeiro, "Adicionar ao Carrinho")?.click();
    });
    expect(adicionarAoCarrinho).toHaveBeenCalledExactlyOnceWith(
      1,
      "v-pp",
      "Cor / Tamanho: Branca / PP",
    );
  });

  it("sem beco sem saída: PP e Branca escolhidos deixam P e Preta apagados, e tocar neles troca a combinação até a Preta P", async () => {
    const preta = {
      ...blusaBrancaP,
      id: "v-preta-p",
      value: "Preta / P",
      stockIncrement: 4,
    };
    await montar({ ...blusa, variants: [blusaBrancaPP, preta] });
    const botao = (rotulo: string) =>
      hospedeiro.querySelector(
        `button[aria-label="${rotulo}"]`,
      ) as HTMLButtonElement;
    const tocar = (rotulo: string) =>
      act(async () => {
        botao(rotulo).click();
      });
    await tocar("PP");
    await tocar("Branca");
    for (const rotulo of ["P", "Preta"]) {
      expect(botao(rotulo).disabled).toBe(false);
      expect(botao(rotulo).classList.contains("line-through")).toBe(true);
    }
    // Os escolhidos continuam clicáveis (desmarcam).
    expect(botao("PP").disabled).toBe(false);
    expect(botao("Branca").disabled).toBe(false);
    await tocar("P");
    expect(botao("P").getAttribute("aria-pressed")).toBe("true");
    expect(botao("PP").getAttribute("aria-pressed")).toBe("false");
    expect(botao("Branca").getAttribute("aria-pressed")).toBe("false");
    await tocar("Preta");
    await act(async () => {
      botaoPorTexto(hospedeiro, "Adicionar ao Carrinho")?.click();
    });
    expect(adicionarAoCarrinho).toHaveBeenCalledExactlyOnceWith(
      1,
      "v-preta-p",
      "Cor / Tamanho: Preta / P",
    );
  });
});
