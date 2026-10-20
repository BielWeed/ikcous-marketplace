// @vitest-environment jsdom
//
// Achado da compra da cliente (celular): as fotos do produto não deslizavam
// com o dedo (só setinhas e bolinhas), e escolher uma cor que tem foto
// própria ESCONDIA setas, bolinhas e miniaturas -- ela via só aquela foto e
// não tinha como voltar ao conjunto. Contrato novo:
//   1. as fotos ficam lado a lado numa faixa que rola na horizontal com
//      encaixe (CSS scroll-snap; o navegador resolve o gesto);
//   2. rolar a faixa (gesto) muda a bolinha ativa, e bolinha/seta/miniatura
//      leva a faixa até a foto;
//   3. escolher variação com foto leva a faixa até a foto dela SEM esconder
//      setas, bolinhas nem miniaturas; tocar de novo desmarca.
//
// O jsdom não tem layout nem rolagem: `clientWidth` e `scrollTo` são
// dublados aqui para provar a LIGAÇÃO (índice <-> posição). O comportamento
// do navegador de verdade (encaixe, inércia) foi medido num Chromium real --
// ver o relatório da frente.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

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

function cor(
  id: string,
  valor: string,
  imageUrl?: string,
  estoque = 5,
): ProductVariant {
  return {
    id,
    productId: "p-blusa",
    name: "Cor",
    value: valor,
    stockIncrement: estoque,
    active: true,
    imageUrl,
  };
}

function blusa(variants: ProductVariant[]): Product {
  return {
    id: "p-blusa",
    name: "Blusa",
    description: "Descrição de teste",
    price: 80,
    images: ["/f1.png", "/f2.png", "/f3.png"],
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

const variantesPadrao = [
  cor("v-azul", "Azul", "/f2.png"),
  cor("v-verde", "Verde", "/f3.png"),
  cor("v-preta", "Preta"),
];

describe("ProductView — a galeria desliza e a variação não esconde as fotos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    // O jsdom não mede nada: a faixa "tem" 300px de largura, o pedido de
    // rolagem fica registrado e a posição passa a ser a pedida (como o
    // navegador faz ao fim da animação).
    scrollTo = vi.fn(function (this: HTMLElement, opcoes: { left: number }) {
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
    hospedeiro = document.createElement("div");
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

  async function montar(produto: Product = blusa(variantesPadrao)) {
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

  const faixa = () =>
    hospedeiro.querySelector<HTMLElement>("[aria-roledescription='carrossel']");
  const bolinhas = () => [
    ...hospedeiro.querySelectorAll<HTMLButtonElement>(
      "button[aria-label^='Foto '][aria-label*=' de ']",
    ),
  ];
  const setas = () =>
    hospedeiro.querySelectorAll(
      "button[aria-label='Foto anterior'], button[aria-label='Próxima foto']",
    );
  const fotoAtiva = () =>
    bolinhas().findIndex((b) => b.getAttribute("aria-current") === "true") + 1;

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

  /** O que o navegador faz quando a cliente arrasta a faixa. */
  async function rolarFaixaPara(posicaoEmPx: number) {
    const f = faixa() as HTMLElement;
    Object.defineProperty(f, "scrollLeft", {
      configurable: true,
      writable: true,
      value: posicaoEmPx,
    });
    await act(async () => {
      f.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
  }

  it("as fotos ficam lado a lado numa faixa que rola com encaixe", async () => {
    await montar();

    const f = faixa();
    expect(f).not.toBeNull();
    expect(f?.className).toContain("overflow-x-auto");
    expect(f?.className).toContain("snap-x");
    expect(f?.className).toContain("snap-mandatory");
    // O dedo vertical continua rolando a página: a faixa só rola na horizontal.
    expect(f?.className).toContain("overflow-y-hidden");

    const fotos = [...hospedeiro.querySelectorAll("img.main-product-image")];
    expect(fotos.map((i) => i.getAttribute("src"))).toEqual([
      "/f1.png",
      "/f2.png",
      "/f3.png",
    ]);
    // Só a primeira é pedida de imediato.
    expect(fotos.map((i) => i.getAttribute("loading"))).toEqual([
      "eager",
      "lazy",
      "lazy",
    ]);
    // Cada foto é um encaixe da faixa.
    for (const img of fotos) {
      expect(img.parentElement?.className).toContain("snap-center");
    }
    // Com a faixa focada, as setas do teclado a rolam.
    expect(f?.getAttribute("tabindex")).toBe("0");
  });

  it("arrastar a faixa muda a bolinha ativa (e o leitor de tela ouve)", async () => {
    await montar();
    expect(fotoAtiva()).toBe(1);

    await rolarFaixaPara(LARGURA * 1);
    expect(fotoAtiva()).toBe(2);
    expect(hospedeiro.textContent).toContain("Foto 2 de 3");

    // Meio caminho entre duas fotos fica na mais próxima.
    await rolarFaixaPara(LARGURA * 2 - 100);
    expect(fotoAtiva()).toBe(3);

    // Um gesto da cliente NÃO é "devolvido" como pedido de rolagem.
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("bolinha, seta e miniatura levam a faixa até a foto", async () => {
    await montar();

    await tocar(bolinhas()[2]);
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: LARGURA * 2 }),
    );
    expect(fotoAtiva()).toBe(3);

    // Seta "Próxima" na última foto volta à primeira (circular, como era).
    await tocar(hospedeiro.querySelector("button[aria-label='Próxima foto']"));
    expect(fotoAtiva()).toBe(1);
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: 0 }),
    );
  });

  it("enquanto a faixa anda até a foto pedida, a bolinha não pisca pelas do meio", async () => {
    await montar();

    await tocar(bolinhas()[2]);
    expect(fotoAtiva()).toBe(3);

    // A animação passa pela foto 2 a caminho da 3: não mexe na bolinha.
    await rolarFaixaPara(LARGURA * 1);
    expect(fotoAtiva()).toBe(3);
    await rolarFaixaPara(LARGURA * 2);
    expect(fotoAtiva()).toBe(3);

    // Chegou: a partir daqui o gesto da cliente volta a mandar.
    await rolarFaixaPara(0);
    expect(fotoAtiva()).toBe(1);
  });

  it("o toque da cliente na faixa vale mais que uma rolagem pedida e abandonada", async () => {
    await montar();

    await tocar(bolinhas()[2]);
    // A cliente pega a faixa no meio do caminho.
    await act(async () => {
      faixa()?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    await rolarFaixaPara(LARGURA * 1);
    expect(fotoAtiva()).toBe(2);
  });

  it("escolher variação com foto leva a faixa até a foto e NÃO esconde setas, bolinhas nem fotos", async () => {
    await montar();
    expect(bolinhas()).toHaveLength(3);
    expect(setas()).toHaveLength(2);

    await tocar(opcao("Verde"));

    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: LARGURA * 2 }),
    );
    expect(fotoAtiva()).toBe(3);
    // Nada sumiu: é o defeito medido (antes: 0 bolinhas, 0 setas, 1 foto).
    expect(bolinhas()).toHaveLength(3);
    expect(setas()).toHaveLength(2);
    expect(hospedeiro.querySelectorAll("img.main-product-image")).toHaveLength(
      3,
    );

    // E a cliente ainda passa para as outras fotos do conjunto.
    await tocar(bolinhas()[0]);
    expect(fotoAtiva()).toBe(1);
  });

  it("variação SEM foto não puxa a galeria", async () => {
    await montar();
    await tocar(bolinhas()[1]);
    scrollTo.mockClear();

    await tocar(opcao("Preta"));

    expect(fotoAtiva()).toBe(2);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("tocar de novo na variação desmarca e a galeria continua inteira", async () => {
    await montar();
    await tocar(opcao("Azul"));
    expect(opcao("Azul").getAttribute("aria-pressed")).toBe("true");
    expect(fotoAtiva()).toBe(2);

    await tocar(opcao("Azul"));

    expect(opcao("Azul").getAttribute("aria-pressed")).toBe("false");
    expect(bolinhas()).toHaveLength(3);
    expect(setas()).toHaveLength(2);
  });

  it("foto da variação que o produto não tem entra no fim da faixa e sai ao desmarcar", async () => {
    await montar(blusa([cor("v-rosa", "Rosa", "/so-da-rosa.png")]));
    expect(bolinhas()).toHaveLength(3);

    await tocar(opcao("Rosa"));
    expect(bolinhas()).toHaveLength(4);
    expect(fotoAtiva()).toBe(4);
    const fotos = [...hospedeiro.querySelectorAll("img.main-product-image")];
    expect(fotos[3]?.getAttribute("src")).toBe("/so-da-rosa.png");

    await tocar(opcao("Rosa"));
    expect(bolinhas()).toHaveLength(3);
    // A foto ativa nunca fica apontando para uma foto que deixou de existir.
    expect(fotoAtiva()).toBe(3);
  });

  it("produto de uma foto só não vira carrossel", async () => {
    await montar({ ...blusa([]), images: ["/f1.png"] });

    expect(faixa()).toBeNull();
    expect(bolinhas()).toHaveLength(0);
    expect(setas()).toHaveLength(0);
    expect(hospedeiro.querySelectorAll("img.main-product-image")).toHaveLength(
      1,
    );
  });
});
