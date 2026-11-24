// @vitest-environment jsdom
//
// Bordas da galeria de fotos NA PÁGINA DO PRODUTO que a caça por mutação de
// 24/11 achou sem teste (a lógica mora no `ProductView`, não no componente):
//
//  1. Variação cuja foto é a PRIMEIRA do produto (posição 0): escolher essa
//     variação, com a cliente numa foto lá no fim, tem de levá-la de volta à
//     capa. A posição 0 é a mais fácil de se perder por um `> 0` no lugar de
//     `>= 0` -- e é o caso mais comum (a cor "padrão" usa a foto de capa).
//  2. Duas escolhas (cor e tamanho) apontando a MESMA foto que o produto não
//     tem: a foto entra UMA vez no fim da faixa, não duas.
//  3. A miniatura do rodapé fixo (e do voo para o carrinho) é a primeira foto
//     REAL do produto quando nenhuma variação aponta foto -- pulando o marcador
//     "Sem Imagem" que o cadastro antigo deixou na frente.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Product, ProductVariant } from "@/types";

vi.mock("@/utils/cartAnimation", () => ({
  triggerFlyingCartAnimation: vi.fn(),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

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

const LARGURA = 300;
const MARCADOR = "https://placehold.co/600x400?text=Sem+Imagem";

function linha(valor: string, nome: string, imageUrl?: string): ProductVariant {
  return {
    id: `v-${nome}-${valor}`,
    productId: "p-blusa",
    name: nome,
    value: valor,
    stockIncrement: 5,
    active: true,
    imageUrl,
  };
}

function blusa(images: string[], variants: ProductVariant[] = []): Product {
  return {
    id: "p-blusa",
    name: "Blusa",
    description: "Descrição de teste",
    price: 80,
    images,
    category: "roupas",
    stock: 20,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    variants,
  };
}

describe("ProductView — a galeria nos limites da escolha de variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;

  // A página é grande: o primeiro `import` (a frio) passa do teto de 5 s do CI.
  beforeAll(async () => {
    await import("@/views/customer/ProductView");
  }, 60_000);

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    const scrollTo = vi.fn(function (
      this: HTMLElement,
      opcoes: { left: number },
    ) {
      Object.defineProperty(this, "scrollLeft", {
        configurable: true,
        writable: true,
        value: opcoes.left,
      });
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => LARGURA,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
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
    // biome-ignore lint/performance/noDelete: tirar o dublê do protótipo.
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    // biome-ignore lint/performance/noDelete: tirar o dublê do protótipo.
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
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
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });
  }

  const bolinhas = () => [
    ...hospedeiro.querySelectorAll<HTMLButtonElement>(
      "button[aria-label^='Foto '][aria-label*=' de ']",
    ),
  ];
  const fotoAtiva = () =>
    bolinhas().findIndex((b) => b.getAttribute("aria-current") === "true") + 1;
  const fotosDaFaixa = () =>
    [
      ...hospedeiro.querySelectorAll<HTMLImageElement>(
        "img.main-product-image",
      ),
    ].map((img) => img.getAttribute("src"));
  const fotoExibida = () => fotosDaFaixa()[fotoAtiva() - 1];

  function opcao(valor: string) {
    const span = [...hospedeiro.querySelectorAll("button span")].find(
      (el) => el.textContent === valor,
    );
    return span?.closest("button") as HTMLButtonElement;
  }

  async function tocar(el: Element | null | undefined) {
    expect(el).toBeTruthy();
    await act(async () => {
      (el as HTMLElement).click();
    });
  }

  it("variação que aponta a capa (posição 0) leva a cliente de volta à capa", async () => {
    await montar(
      blusa(
        ["/capa.png", "/vermelho.png", "/detalhe.png"],
        [linha("Vermelho", "Cor", "/capa.png"), linha("Azul", "Cor")],
      ),
    );
    await tocar(bolinhas()[2]);
    expect(fotoExibida()).toBe("/detalhe.png");

    await tocar(opcao("Vermelho"));

    expect(opcao("Vermelho").getAttribute("aria-pressed")).toBe("true");
    expect(fotoAtiva()).toBe(1);
    expect(fotoExibida()).toBe("/capa.png");
  });

  it("cor e tamanho apontando a mesma foto que o produto não tem: ela entra uma vez só", async () => {
    await montar(
      blusa(
        ["/capa.png"],
        [
          linha("Vermelho", "Cor", "/so-das-variacoes.png"),
          linha("Azul", "Cor"),
          linha("P", "Tamanho", "/so-das-variacoes.png"),
          linha("M", "Tamanho"),
        ],
      ),
    );
    expect(bolinhas()).toHaveLength(0); // uma foto só: sem bolinhas

    await tocar(opcao("Vermelho"));
    await tocar(opcao("P"));

    expect(fotosDaFaixa()).toEqual(["/capa.png", "/so-das-variacoes.png"]);
    expect(bolinhas()).toHaveLength(2);
  });

  it("cor e tamanho com foto própria: a galeria vai para a foto da opção que a cliente acabou de tocar", async () => {
    await montar(
      blusa(
        ["/capa.png", "/vermelho.png", "/p.png"],
        [
          linha("Vermelho", "Cor", "/vermelho.png"),
          linha("Azul", "Cor"),
          linha("P", "Tamanho", "/p.png"),
          linha("M", "Tamanho"),
        ],
      ),
    );
    await tocar(opcao("Vermelho"));
    expect(fotoExibida()).toBe("/vermelho.png");

    await tocar(opcao("P"));
    expect(fotoExibida()).toBe("/p.png");

    // A ordem em que a cliente toca é que manda, não a ordem da grade.
    await tocar(opcao("Vermelho")); // desmarca
    await tocar(opcao("Vermelho")); // marca de novo, agora depois do P
    expect(fotoExibida()).toBe("/vermelho.png");
  });

  it("sem foto de variação, o rodapé fixo mostra a primeira foto do produto", async () => {
    await montar(blusa(["/f1.png", "/f2.png"]));
    const miniatura = document.querySelector(".bottom-docked-navigation img");
    expect(miniatura?.getAttribute("src")).toBe("/f1.png");
  });

  it("marcador 'Sem Imagem' na frente: o rodapé fixo pula para a primeira foto REAL", async () => {
    await montar(blusa([MARCADOR, "/real.png"]));
    const miniatura = document.querySelector(".bottom-docked-navigation img");
    expect(miniatura?.getAttribute("src")).toBe("/real.png");
    expect(document.querySelector('img[src*="placehold.co"]')).toBeNull();
  });
});
