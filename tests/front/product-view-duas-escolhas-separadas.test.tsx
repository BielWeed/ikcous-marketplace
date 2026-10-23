// @vitest-environment jsdom
//
// Defeito carrinho-checkout-1, lado da TELA DO PRODUTO: produto de cadastro
// antigo, com a cor e o tamanho em linhas separadas de product_variants
// ("Cor: Azul", "Tamanho: P"). `ProductView` entregava ao carrinho só o id da
// primeira escolha (`selectedVariantObjects[0]?.id`), então "Azul-P" e
// "Azul-M" chegavam com o MESMO id e viravam uma linha só.
//
// Agora a tela entrega a CHAVE da combinação (`idDaCor~idDoTamanho`, na ordem
// do cadastro, nunca na ordem dos toques) e o nome completo das duas escolhas.
// Modelo estrutural copiado de product-view-variante-composta.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { separarChave } from "@/lib/escolhas-do-item";
import { precoVendido } from "@/lib/preco-vendido";
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

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const variante = (
  id: string,
  name: string,
  value: string,
  stockIncrement: number,
  priceOverride?: number,
) => ({
  id,
  productId: "p-camiseta",
  name,
  value,
  stockIncrement,
  active: true,
  ...(priceOverride === undefined ? {} : { priceOverride }),
});

// A ordem do cadastro: o grupo Cor vem antes do Tamanho (e Rosa, da mesma
// cor, aparece DEPOIS de P -- a ordem do grupo, não a posição da linha, é que
// decide o primeiro id).
const camiseta: Product = {
  id: "p-camiseta",
  name: "Camiseta",
  description: "Descrição de teste",
  price: 30,
  images: [],
  category: "geral",
  stock: 16,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  variants: [
    variante("vc-azul", "Cor", "Azul", 5),
    variante("vt-p", "Tamanho", "P", 4),
    variante("vc-rosa", "Cor", "Rosa", 5),
    variante("vt-m", "Tamanho", "M", 2),
  ],
};

const botao = (raiz: ParentNode, rotulo: string) =>
  raiz.querySelector<HTMLButtonElement>(`button[aria-label="${rotulo}"]`);

function botaoPorTexto(raiz: ParentNode, texto: string) {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("ProductView — cor e tamanho de cadastro antigo viram UMA combinação no carrinho", () => {
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

  async function montar(produto: Product = camiseta) {
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

  async function escolher(...rotulos: string[]) {
    for (const rotulo of rotulos) {
      await act(async () => {
        botao(hospedeiro, rotulo)?.click();
      });
    }
  }

  async function adicionar() {
    await act(async () => {
      botaoPorTexto(hospedeiro, "Adicionar ao Carrinho")?.click();
    });
  }

  it("Azul + P entrega a chave das DUAS escolhas e os dois nomes", async () => {
    await montar();
    await escolher("Azul", "P");
    await adicionar();

    expect(adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    const [quantidade, variantId, nomes] = adicionarAoCarrinho.mock.calls[0];
    expect(quantidade).toBe(1);
    expect(variantId).toBe("vc-azul~vt-p");
    expect(nomes).toBe("Cor: Azul, Tamanho: P");
  });

  it("a ordem dos toques não muda a combinação: P e depois Azul é a MESMA chave", async () => {
    await montar();
    await escolher("P", "Azul");
    await adicionar();

    const [, variantId, nomes] = adicionarAoCarrinho.mock.calls[0];
    expect(variantId).toBe("vc-azul~vt-p");
    expect(nomes).toBe("Cor: Azul, Tamanho: P");
  });

  it("Azul + M é outra combinação (outra chave), não a do Azul + P", async () => {
    await montar();
    await escolher("Azul", "M");
    await adicionar();

    const [, variantId, nomes] = adicionarAoCarrinho.mock.calls[0];
    expect(variantId).toBe("vc-azul~vt-m");
    expect(nomes).toBe("Cor: Azul, Tamanho: M");
  });

  it("só a cor escolhida: pede o tamanho e não entrega nada ao carrinho", async () => {
    await montar();
    await escolher("Azul");
    await adicionar();

    expect(adicionarAoCarrinho).not.toHaveBeenCalled();
  });

  it("produto com UM grupo só segue entregando o id puro, sem chave composta", async () => {
    await montar({
      ...camiseta,
      variants: [
        variante("vt-p", "Tamanho", "P", 4),
        variante("vt-m", "Tamanho", "M", 2),
      ],
    });
    await escolher("M");
    await adicionar();

    expect(adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    const [, variantId, nomes] = adicionarAoCarrinho.mock.calls[0];
    expect(variantId).toBe("vt-m");
    expect(nomes).toBe("Tamanho: M");
  });
});

// O PREÇO: o servidor cobra `COALESCE(v.price_override, p.preco_venda)` do
// PRIMEIRO id enviado, e o carrinho soma pelo mesmo id. A página tem de mostrar
// exatamente esse número, qualquer que seja a ordem dos toques e a ordem em
// que o banco devolveu as linhas -- antes mostrava o ajuste do ÚLTIMO toque.
describe("ProductView — o preço mostrado é o que o carrinho e o servidor cobram", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let adicionarAoCarrinho: ReturnType<
    typeof vi.fn<
      (quantity: number, variantId?: string, variantNames?: string) => void
    >
  >;

  // Produto R$ 50; cadastro Cor -> Tamanho; só o G tem ajuste (R$ 60).
  const comAjusteNoG = (linhas: ReturnType<typeof variante>[]): Product => ({
    ...camiseta,
    price: 50,
    variants: linhas,
  });
  const linhasDoAjuste = () => [
    variante("vc-azul", "Cor", "Azul", 5),
    variante("vt-m", "Tamanho", "M", 4),
    variante("vt-g", "Tamanho", "G", 3, 60),
  ];

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
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

  async function montar(produto: Product) {
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

  async function tocarEAdicionar(...rotulos: string[]) {
    for (const rotulo of rotulos) {
      await act(async () => {
        botao(hospedeiro, rotulo)?.click();
      });
    }
    await act(async () => {
      botaoPorTexto(hospedeiro, "Adicionar ao Carrinho")?.click();
    });
  }

  /** O que o carrinho cobraria pela linha enviada: o preço do PRIMEIRO id. */
  function precoDaLinhaEnviada(produto: Product): number {
    const [, chave] = adicionarAoCarrinho.mock.calls[0];
    const { variantId } = separarChave(chave);
    return precoVendido(
      produto,
      produto.variants?.find((v) => v.id === variantId),
    );
  }

  it("G e depois Azul: a página mostra R$ 50, o mesmo da linha do carrinho (antes mostrava R$ 60 e cobrava R$ 50)", async () => {
    const produto = comAjusteNoG(linhasDoAjuste());
    await montar(produto);
    await tocarEAdicionar("G", "Azul");
    // (o clique de adicionar veio depois dos dois toques)
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("R$ 50,00");
    expect(texto).not.toContain("R$ 60,00");
    expect(adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    expect(adicionarAoCarrinho.mock.calls[0][1]).toBe("vc-azul~vt-g");
    expect(precoDaLinhaEnviada(produto)).toBe(50);
  });

  it("Azul e depois G: o mesmo número, a mesma linha", async () => {
    const produto = comAjusteNoG(linhasDoAjuste());
    await montar(produto);
    await tocarEAdicionar("Azul", "G");
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("R$ 50,00");
    expect(texto).not.toContain("R$ 60,00");
    expect(adicionarAoCarrinho.mock.calls[0][1]).toBe("vc-azul~vt-g");
    expect(precoDaLinhaEnviada(produto)).toBe(50);
  });

  it("embaralhar as linhas que o banco devolve não muda a chave, o primeiro id nem o preço", async () => {
    const ordens = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 2, 0],
    ];
    const vistos = new Set<string>();
    for (const ordem of ordens) {
      const linhas = linhasDoAjuste();
      const produto = comAjusteNoG(ordem.map((i) => linhas.at(i)!));
      adicionarAoCarrinho.mockClear();
      await montar(produto);
      await tocarEAdicionar("G", "Azul");
      vistos.add(
        JSON.stringify([
          adicionarAoCarrinho.mock.calls[0][1],
          precoDaLinhaEnviada(produto),
          hospedeiro.textContent?.includes("R$ 50,00"),
        ]),
      );
      await act(async () => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
    }
    expect([...vistos]).toEqual([JSON.stringify(["vc-azul~vt-g", 50, true])]);
  });

  it("com UMA escolha o ajuste do tamanho aparece e é cobrado, como sempre", async () => {
    const produto = comAjusteNoG([
      variante("vt-m", "Tamanho", "M", 4),
      variante("vt-g", "Tamanho", "G", 3, 60),
    ]);
    await montar(produto);
    await tocarEAdicionar("G");
    expect(hospedeiro.textContent).toContain("R$ 60,00");
    expect(adicionarAoCarrinho.mock.calls[0][1]).toBe("vt-g");
    expect(precoDaLinhaEnviada(produto)).toBe(60);
  });

  it("sem variação nenhuma o preço é o do produto", async () => {
    const produto: Product = { ...camiseta, price: 50, variants: [] };
    await montar(produto);
    expect(hospedeiro.textContent).toContain("R$ 50,00");
  });
});
