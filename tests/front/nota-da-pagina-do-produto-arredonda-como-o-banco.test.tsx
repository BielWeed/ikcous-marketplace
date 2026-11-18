// @vitest-environment jsdom
//
// O mesmo produto aparecia com nota 4,9 no cartão do catálogo e 4,8 na página.
// O catálogo vem do banco (`round(avg(rating), 1)`, metade para cima: 4,85 vira
// 4,9). A página somava com números do JavaScript e `toFixed(1)`: 97 / 20 é
// 4,8499999999999996 na memória, então saía "4,8". Agora a média é feita em
// décimos INTEIROS (metade para cima, sem ponto flutuante), igual ao banco.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, Review } from "@/types";

let avaliacoesDoHook: Review[] = [];

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: avaliacoesDoHook,
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

const produto: Product = {
  id: "prod-nota",
  name: "Produto da Nota",
  description: "Descrição de teste",
  price: 50,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
};

// `grupos`: [nota, quantas avaliações com essa nota].
function avaliacoes(grupos: Array<[number, number]>): Review[] {
  const lista: Review[] = [];
  for (const [rating, quantas] of grupos) {
    for (let i = 0; i < quantas; i++) {
      lista.push({
        id: `r${rating}-${i}`,
        productId: "prod-nota",
        customerName: `Cliente ${rating}-${i}`,
        rating,
        comment: `Comentário ${rating}-${i}`,
        verified: true,
        helpful: 0,
        createdAt: "2026-10-01T12:00:00Z",
      });
    }
  }
  return lista;
}

describe("ProductView — a nota da página arredonda como o catálogo (metade para cima)", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;

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
    avaliacoesDoHook = [];
  });

  async function montar(lista: Review[]) {
    avaliacoesDoHook = lista;
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });
  }

  const textoDaSecao = () =>
    hospedeiro.querySelector("#reviews-section")?.textContent ?? "";
  const notaNoJsonLd = () => {
    const bruto = document.getElementById(
      "product-structured-data",
    )?.textContent;
    return bruto
      ? (JSON.parse(bruto) as { aggregateRating?: { ratingValue?: string } })
          .aggregateRating?.ratingValue
      : undefined;
  };

  it("17 notas 5 e 3 notas 4 (média 4,85): a página mostra 4,9, como o catálogo", async () => {
    await montar(
      avaliacoes([
        [5, 17],
        [4, 3],
      ]),
    );

    expect(hospedeiro.textContent).toContain("4,9 (20)");
    expect(textoDaSecao()).toContain("4,9");
    expect(textoDaSecao()).not.toContain("4,8");
    // O texto lido pelos buscadores sai da mesma conta.
    expect(notaNoJsonLd()).toBe("4.9");
  });

  it("controle: média 4,84 (121 em 25) continua 4,8", async () => {
    // 21 notas 5 e 4 notas 4 = 105 + 16 = 121.
    await montar(
      avaliacoes([
        [5, 21],
        [4, 4],
      ]),
    );

    expect(hospedeiro.textContent).toContain("4,8 (25)");
    expect(textoDaSecao()).not.toContain("4,9");
    expect(notaNoJsonLd()).toBe("4.8");
  });

  it("controle: média 4,86 (243 em 50) sobe para 4,9", async () => {
    // 43 notas 5 e 7 notas 4 = 215 + 28 = 243.
    await montar(
      avaliacoes([
        [5, 43],
        [4, 7],
      ]),
    );

    expect(hospedeiro.textContent).toContain("4,9 (50)");
    expect(notaNoJsonLd()).toBe("4.9");
  });

  it("controles: só notas 5 dão 5,0 e só notas 1 dão 1,0", async () => {
    await montar(avaliacoes([[5, 3]]));
    expect(hospedeiro.textContent).toContain("5,0 (3)");
    expect(notaNoJsonLd()).toBe("5.0");

    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar(avaliacoes([[1, 2]]));
    expect(hospedeiro.textContent).toContain("1,0 (2)");
    expect(notaNoJsonLd()).toBe("1.0");
  });

  it("controle: sem avaliações a página não mostra nota calculada, só 'Sem avaliações ainda'", async () => {
    await montar([]);

    expect(textoDaSecao()).toContain("Sem avaliações ainda");
    expect(textoDaSecao()).not.toContain("Baseado em");
    expect(notaNoJsonLd()).toBeUndefined();
  });
});
