// @vitest-environment jsdom
//
// Caça (rodada 347): produto de cadastro antigo com GRUPOS INDEPENDENTES --
// Cor (Azul 100 / Vermelho 120) e Tamanho (P a 50 / M sem ajuste). O servidor
// cobra o preço da variação PRINCIPAL (a do grupo de nome menor: a Cor), então
// nenhuma combinação custa 50. Mas a cliente que tocava só em "P" via a página
// cair de "A partir de R$ 100" para "R$ 50,00" (o preço da escolha PARCIAL, sem
// "A partir de"), e voltar a R$ 100 ao escolher a cor: preço anunciado que
// ninguém paga.
//
// Regra: enquanto a escolha estiver incompleta e o grupo principal (Cor) ainda
// não tiver sido escolhido, a página segue dizendo o preço de vitrine. Escolhido
// o grupo principal o preço já é exato (a outra escolha não o muda), e escolha
// completa vale `precoDaEscolha`, como sempre. Montagem copiada de
// product-view-duas-escolhas-separadas.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { separarChave } from "@/lib/escolhas-do-item";
import { precoVendido } from "@/lib/preco-vendido";
import type { Product, ProductVariant } from "@/types";

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
  priceOverride?: number,
): ProductVariant => ({
  id,
  productId: "p-camiseta",
  name,
  value,
  stockIncrement: 2,
  active: true,
  ...(priceOverride === undefined ? {} : { priceOverride }),
});

const produtoCom = (variants: ProductVariant[]): Product => ({
  id: "p-camiseta",
  name: "Camiseta",
  description: "Descrição de teste",
  price: 90,
  images: [],
  category: "geral",
  stock: 8,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  variants,
});

// Os números escritos à mão: a vitrine diz "A partir de R$ 100" (o menor preço
// da Cor, a variação principal); o ajuste de R$ 50 do P nunca é cobrado.
const camisetaLegada = produtoCom([
  variante("vc-azul", "Cor", "Azul", 100),
  variante("vc-vermelho", "Cor", "Vermelho", 120),
  variante("vt-p", "Tamanho", "P", 50),
  variante("vt-m", "Tamanho", "M"),
]);

describe("ProductView — escolha parcial de cadastro antigo não mostra preço que ninguém paga", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;
  const adicionar = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    hospedeiro = document.createElement("main");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
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
          onAddToCart={adicionar}
          onBack={() => {}}
        />,
      );
    });
  }

  const tocar = async (...rotulos: string[]) => {
    for (const rotulo of rotulos) {
      await act(async () => {
        hospedeiro
          .querySelector<HTMLButtonElement>(`button[aria-label="${rotulo}"]`)
          ?.click();
      });
    }
  };

  const precoGrande = () =>
    [...hospedeiro.querySelectorAll("span[class*='text-[30px]']")]
      .find((el) => el.textContent?.trim().startsWith("R$"))
      ?.textContent?.trim();

  const barraFixa = () =>
    document.querySelector<HTMLElement>(".bottom-docked-navigation");

  const precoDoJsonLd = () =>
    JSON.parse(
      document.getElementById("product-structured-data")?.textContent ?? "{}",
    ).offers?.price;

  const dizAPartirDe = () => hospedeiro.textContent?.includes("A partir de");

  it("antes de escolher: A partir de R$ 100 (o menor preço da Cor)", async () => {
    await montar(camisetaLegada);

    expect(precoGrande()).toBe("R$ 100,00");
    expect(dizAPartirDe()).toBe(true);
    expect(precoDoJsonLd()).toBe(100);
  });

  it("só o P (sem a cor): continua A partir de R$ 100, nunca R$ 50", async () => {
    await montar(camisetaLegada);
    await tocar("P");

    expect(precoGrande()).toBe("R$ 100,00");
    expect(dizAPartirDe()).toBe(true);
    expect(hospedeiro.textContent).not.toContain("R$ 50,00");
    expect(barraFixa()?.textContent).toContain("R$ 100,00");
    expect(barraFixa()?.textContent).toContain("A partir de");
    expect(barraFixa()?.textContent).not.toContain("R$ 50,00");
    expect(precoDoJsonLd()).toBe(100);
  });

  it("só o M (sem ajuste): também não cai no preço base de R$ 90", async () => {
    await montar(camisetaLegada);
    await tocar("M");

    expect(precoGrande()).toBe("R$ 100,00");
    expect(dizAPartirDe()).toBe(true);
    expect(hospedeiro.textContent).not.toContain("R$ 90,00");
  });

  it("P e depois Azul: escolha completa, R$ 100 sem 'A partir de', e a linha do carrinho cobra o mesmo", async () => {
    await montar(camisetaLegada);
    await tocar("P", "Azul");

    expect(precoGrande()).toBe("R$ 100,00");
    expect(dizAPartirDe()).toBe(false);

    await act(async () => {
      [...hospedeiro.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("Adicionar ao Carrinho"))
        ?.click();
    });
    expect(adicionar).toHaveBeenCalledTimes(1);
    const [, chave] = adicionar.mock.calls[0];
    expect(chave).toBe("vc-azul~vt-p");
    expect(
      precoVendido(
        camisetaLegada,
        camisetaLegada.variants?.find(
          (v) => v.id === separarChave(chave).variantId,
        ),
      ),
    ).toBe(100);
  });

  it("P e depois Vermelho: R$ 120 (a Cor manda, o ajuste do P não)", async () => {
    await montar(camisetaLegada);
    await tocar("P", "Vermelho");

    expect(precoGrande()).toBe("R$ 120,00");
    expect(dizAPartirDe()).toBe(false);
    expect(precoDoJsonLd()).toBe(120);
  });

  it("só a cor Vermelho (o grupo principal): o preço já é exato, R$ 120 sem 'A partir de'", async () => {
    await montar(camisetaLegada);
    await tocar("Vermelho");

    expect(precoGrande()).toBe("R$ 120,00");
    expect(dizAPartirDe()).toBe(false);
  });

  it("desmarcar o Azul depois de P e Azul: volta ao preço de vitrine, não a R$ 50", async () => {
    await montar(camisetaLegada);
    await tocar("P", "Azul", "Azul");

    expect(precoGrande()).toBe("R$ 100,00");
    expect(dizAPartirDe()).toBe(true);
    expect(hospedeiro.textContent).not.toContain("R$ 50,00");
  });

  it("controle: produto de UM grupo só segue mostrando o preço da escolha (R$ 50 do P)", async () => {
    await montar(
      produtoCom([
        variante("vt-p", "Tamanho", "P", 50),
        variante("vt-g", "Tamanho", "G", 60),
      ]),
    );
    expect(dizAPartirDe()).toBe(true);
    expect(precoGrande()).toBe("R$ 50,00");

    await tocar("G");
    expect(precoGrande()).toBe("R$ 60,00");
    expect(dizAPartirDe()).toBe(false);
    await tocar("P");
    expect(precoGrande()).toBe("R$ 50,00");
    expect(dizAPartirDe()).toBe(false);
  });

  it("controle: grade composta com só um atributo marcado segue restringindo a vitrine", async () => {
    await montar(
      produtoCom(
        ["P / Azul", "P / Preto", "G / Azul", "G / Preto"].map((valor) => ({
          ...variante(`v-${valor}`, "Tamanho / Cor", valor, 90),
        })),
      ),
    );
    await tocar("G");
    expect(precoGrande()).toBe("R$ 90,00");
    expect(dizAPartirDe()).toBe(false);
  });

  it("controle: sem variação o preço é o do produto", async () => {
    await montar(produtoCom([]));
    expect(precoGrande()).toBe("R$ 90,00");
    expect(dizAPartirDe()).toBe(false);
  });
});
