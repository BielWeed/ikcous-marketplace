// @vitest-environment jsdom
//
// DEFEITO MEDIDO: 61 das 126 peças da Savy (48%) têm UMA variante só. Na
// página do produto a cliente tocava em "Adicionar" e recebia "Falta escolher"
// por uma opção que não tinha concorrente.
//
// A REGRA (decisão de produto do dono, 02/11/2026): fileira com UM valor só,
// esse valor com estoque, já abre MARCADA. Fileira com 2+ valores continua
// esperando a cliente (nunca se chuta tamanho entre vários). O que vai ao
// carrinho é EXATAMENTE o que ia quando a cliente tocava no chip: mesmo id da
// linha, mesmo nome, mesma quantidade.
//
// Harness copiado de product-view-variante-composta.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "sonner";

import { chaveDaVariacao } from "@/lib/escolhas-do-item";
import type { Product, ProductVariant } from "@/types";
import { opcaoDaVariacao } from "./helpers/opcao-da-variacao";

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
    config: { enableReviews: false },
    isLoaded: true,
  }),
}));

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
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
  stockIncrement = 5,
  extra: Partial<ProductVariant> = {},
): ProductVariant => ({
  id,
  productId: "prod-camisa",
  name,
  value,
  stockIncrement,
  active: true,
  ...extra,
});

const produtoCom = (
  variants: ProductVariant[],
  id = "prod-camisa",
): Product => ({
  id,
  name: "Camisa Boa",
  description: "Descrição de teste",
  price: 50,
  images: ["https://example.com/img.png"],
  category: "roupas",
  stock: 10,
  sold: 3,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  rating: 4.5,
  reviewCount: 12,
  variants,
});

describe("ProductView — opção única já vem marcada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let adicionarAoCarrinho: ReturnType<
    typeof vi.fn<
      (quantity: number, variantId?: string, variantNames?: string) => void
    >
  >;

  beforeEach(() => {
    vi.mocked(toast.warning).mockClear();
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

  // `chave` imita o `key` que o App dá à tela (um por produto): trocar de
  // produto REMONTA a tela, e é daí que a escolha do anterior não atravessa.
  async function montar(produto: Product) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          key={`product-detail-${produto.id}`}
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={adicionarAoCarrinho}
          onBack={() => {}}
        />,
      );
    });
  }

  const opcao = (rotulo: string) => opcaoDaVariacao(hospedeiro, rotulo)!;
  const marcado = (rotulo: string) =>
    opcao(rotulo).getAttribute("aria-pressed");
  const botaoAdicionar = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Adicionar ao Carrinho"),
    ) as HTMLButtonElement;
  const adicionar = () =>
    act(async () => {
      botaoAdicionar().click();
    });
  const tocar = (rotulo: string) =>
    act(async () => {
      opcao(rotulo).click();
    });

  it("um tamanho só: já marcado, mostra o preço dele e o Adicionar entrega a linha de sempre", async () => {
    await montar(
      produtoCom([variante("var-m", "Tamanho", "M", 3, { priceOverride: 65 })]),
    );
    expect(marcado("M")).toBe("true");
    expect(hospedeiro.textContent).toContain("R$ 65,00");

    await adicionar();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(adicionarAoCarrinho).toHaveBeenCalledExactlyOnceWith(
      1,
      "var-m",
      "Tamanho: M",
    );
  });

  it("tocar na opção única já marcada NÃO a desmarca (o toque natural de quem confirma)", async () => {
    await montar(produtoCom([variante("var-m", "Tamanho", "M", 3)]));
    await tocar("M");
    expect(marcado("M")).toBe("true");
    await adicionar();
    expect(adicionarAoCarrinho).toHaveBeenCalledExactlyOnceWith(
      1,
      "var-m",
      "Tamanho: M",
    );
  });

  it("tamanho E cor únicos (grade composta): os dois marcados, uma linha só", async () => {
    await montar(
      produtoCom([
        variante("var-azul-m", "Cor / Tamanho", "Azul / M", 4, {
          priceOverride: 75,
        }),
      ]),
    );
    expect(marcado("M")).toBe("true");
    expect(marcado("Azul")).toBe("true");
    await adicionar();
    expect(adicionarAoCarrinho).toHaveBeenCalledExactlyOnceWith(
      1,
      "var-azul-m",
      "Cor / Tamanho: Azul / M",
    );
  });

  it("três eixos únicos: os três marcados", async () => {
    await montar(
      produtoCom([
        variante("var-3", "Cor / Tamanho / Manga", "Azul / M / Longa", 6),
      ]),
    );
    for (const valor of ["M", "Azul", "Longa"])
      expect(marcado(valor)).toBe("true");
    await adicionar();
    expect(adicionarAoCarrinho).toHaveBeenCalledExactlyOnceWith(
      1,
      "var-3",
      "Cor / Tamanho / Manga: Azul / M / Longa",
    );
  });

  it("cadastro antigo (tamanho e cor em grupos separados), um de cada: leva as duas escolhas", async () => {
    await montar(
      produtoCom([
        variante("cor-azul", "Cor", "Azul", 4),
        variante("tam-m", "Tamanho", "M", 3, { priceOverride: 65 }),
      ]),
    );
    expect(marcado("M")).toBe("true");
    expect(marcado("Azul")).toBe("true");
    await adicionar();
    expect(adicionarAoCarrinho).toHaveBeenCalledExactlyOnceWith(
      1,
      chaveDaVariacao("cor-azul", ["tam-m"]),
      "Cor: Azul, Tamanho: M",
    );
  });

  it("referência: tocar à mão em cada opção entrega o mesmo que a pré-marcação (cadastro antigo)", async () => {
    await montar(
      produtoCom([
        variante("cor-azul", "Cor", "Azul", 4),
        variante("tam-m", "Tamanho", "M", 3, { priceOverride: 65 }),
      ]),
    );
    await tocar("M");
    await tocar("Azul");
    await adicionar();
    expect(adicionarAoCarrinho).toHaveBeenCalledExactlyOnceWith(
      1,
      chaveDaVariacao("cor-azul", ["tam-m"]),
      "Cor: Azul, Tamanho: M",
    );
  });

  it("dois tamanhos: nada marcado e o Adicionar continua pedindo a escolha", async () => {
    await montar(
      produtoCom([
        variante("var-p", "Tamanho", "P", 5),
        variante("var-m", "Tamanho", "M", 3),
      ]),
    );
    expect(marcado("P")).toBe("false");
    expect(marcado("M")).toBe("false");
    await adicionar();
    expect(adicionarAoCarrinho).not.toHaveBeenCalled();
    expect(vi.mocked(toast.warning).mock.calls[0]![0]).toBe("Falta escolher");
    expect(
      JSON.stringify(vi.mocked(toast.warning).mock.calls[0]![1]),
    ).toContain("Tamanho");
  });

  it("cor única com dois tamanhos: a cor vem marcada, o tamanho é da cliente, e a escolha dela não é sobrescrita", async () => {
    await montar(
      produtoCom([
        variante("azul-p", "Cor / Tamanho", "Azul / P", 5),
        variante("azul-m", "Cor / Tamanho", "Azul / M", 3),
      ]),
    );
    expect(marcado("Azul")).toBe("true");
    expect(marcado("P")).toBe("false");
    expect(marcado("M")).toBe("false");
    await adicionar();
    expect(adicionarAoCarrinho).not.toHaveBeenCalled();
    expect(
      JSON.stringify(vi.mocked(toast.warning).mock.calls[0]![1]),
    ).toContain("Tamanho");

    await tocar("M");
    expect(marcado("M")).toBe("true");
    expect(marcado("Azul")).toBe("true");
    // Tocar de novo no tamanho dela o desmarca e ele NÃO volta sozinho.
    await tocar("M");
    expect(marcado("M")).toBe("false");
    expect(marcado("Azul")).toBe("true");
    await tocar("P");
    await adicionar();
    expect(adicionarAoCarrinho).toHaveBeenCalledExactlyOnceWith(
      1,
      "azul-p",
      "Cor / Tamanho: Azul / P",
    );
  });

  it("opção única esgotada não é marcada (o produto segue esgotado)", async () => {
    await montar(produtoCom([variante("var-m", "Tamanho", "M", 0)]));
    expect(marcado("M")).toBe("false");
    // Todo o grupo esgotado: o botão vira "Esgotado" (desabilitado), não há
    // "Adicionar" para tocar.
    expect(botaoAdicionar()).toBeUndefined();
    const esgotado = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Esgotado",
    ) as HTMLButtonElement | undefined;
    expect(esgotado?.disabled).toBe(true);
    expect(adicionarAoCarrinho).not.toHaveBeenCalled();
  });

  it("tamanho único com estoque só numa cor: marcado, e a cor segue com a cliente", async () => {
    await montar(
      produtoCom([
        variante("verde-m", "Cor / Tamanho", "Verde / M", 0),
        variante("azul-m", "Cor / Tamanho", "Azul / M", 2),
      ]),
    );
    expect(marcado("M")).toBe("true");
    expect(marcado("Azul")).toBe("false");
    await tocar("Azul");
    await adicionar();
    expect(adicionarAoCarrinho).toHaveBeenCalledExactlyOnceWith(
      1,
      "azul-m",
      "Cor / Tamanho: Azul / M",
    );
  });

  it("a foto própria da opção única entra no fim da faixa desde o início, sem tirar a capa da frente", async () => {
    await montar(
      produtoCom([
        variante("var-rosa", "Cor", "Rosa", 3, { imageUrl: "/so-da-rosa.png" }),
      ]),
    );
    expect(marcado("Rosa")).toBe("true");
    const fotos = [...hospedeiro.querySelectorAll("img.main-product-image")];
    expect(fotos.map((f) => f.getAttribute("src"))).toEqual([
      "https://example.com/img.png",
      "/so-da-rosa.png",
    ]);
  });

  it("trocar de produto remonta a tela: a marca do anterior não atravessa e a do novo nasce", async () => {
    await montar(produtoCom([variante("var-m", "Tamanho", "M", 3)], "a"));
    expect(marcado("M")).toBe("true");
    await montar(
      produtoCom(
        [variante("p", "Tamanho", "P", 3), variante("g", "Tamanho", "G", 3)],
        "b",
      ),
    );
    expect(opcaoDaVariacao(hospedeiro, "M")).toBeNull();
    expect(marcado("P")).toBe("false");
    expect(marcado("G")).toBe("false");
    await montar(produtoCom([variante("var-xl", "Tamanho", "XL", 2)], "c"));
    expect(marcado("XL")).toBe("true");
  });
});
