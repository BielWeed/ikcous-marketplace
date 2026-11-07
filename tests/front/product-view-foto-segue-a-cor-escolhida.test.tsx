// @vitest-environment jsdom
//
// Achado da compra da cliente: numa grade Cor x Tamanho a foto da cor costuma
// estar cadastrada numa linha só (a de um tamanho). Tocar só na COR deixava a
// galeria parada: a foto só aparecia depois de escolher cor E tamanho, e só se
// a linha completa por acaso fosse a que tinha a foto. O card da vitrine já
// resolve isso (`fotoDaCor`); a página do produto agora faz o mesmo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { imagemRedimensionada } from "@/lib/imageUrl";
import type { Product, ProductVariant } from "@/types";
import { triggerFlyingCartAnimation } from "@/utils/cartAnimation";

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

function linha(valor: string, imageUrl?: string): ProductVariant {
  return {
    id: `v-${valor}`,
    productId: "p-blusa",
    name: "Cor / Tamanho",
    value: valor,
    stockIncrement: 5,
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

// A foto de cada cor está numa linha só (Azul no P, Verde no M).
const grade = [
  linha("Azul / P", "/f2.png"),
  linha("Azul / M"),
  linha("Verde / P"),
  linha("Verde / M", "/f3.png"),
];

describe("ProductView — a foto segue a COR, mesmo sem escolher o tamanho", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
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
    hospedeiro = document.createElement("main");
    vi.mocked(triggerFlyingCartAnimation).mockClear();
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

  async function montar(produto: Product = blusa(grade)) {
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

  it("sem foto usa marcador local também no rodapé fixo", async () => {
    await montar({
      ...blusa([]),
      images: ["https://placehold.co/600x400?text=Sem+Imagem"],
    });
    const barra = document.querySelector(".bottom-docked-navigation");
    expect(barra).not.toBeNull();
    expect(barra?.querySelector("img")).toBeNull();
    expect(barra?.textContent).toContain("Sem foto");
    expect(hospedeiro.textContent).toContain("Sem foto");
    expect(document.querySelector('img[src*="placehold.co"]')).toBeNull();
  });

  it("sem foto própria a galeria só inclui a foto real da cor", async () => {
    await montar({
      ...blusa(grade),
      images: ["https://placehold.co/600x400?text=Sem+Imagem"],
    });
    await tocar(opcao("Azul"));
    expect(hospedeiro.querySelector('img[src*="placehold.co"]')).toBeNull();
    const fotos = hospedeiro.querySelectorAll<HTMLImageElement>(
      "img.main-product-image",
    );
    expect(fotos).toHaveLength(1);
    expect(fotos[0]?.getAttribute("src")).toBe("/f2.png");
    expect(hospedeiro.textContent).not.toContain("Sem foto");
    expect(bolinhas()).toHaveLength(0);
  });

  it("rodapé e voo usam a foto reduzida da cor mesmo na linha sem foto", async () => {
    const azul =
      "https://fotos.supabase.co/storage/v1/object/public/produtos/azul.jpg";
    await montar(
      blusa([
        linha("Azul / P", azul),
        linha("Azul / M"),
        linha("Verde / P"),
        linha("Verde / M"),
      ]),
    );
    await tocar(opcao("Azul"));
    await tocar(opcao("M"));
    const barra = document.querySelector(".bottom-docked-navigation");
    const miniatura = barra?.querySelector("img");
    expect(miniatura?.getAttribute("src")).toBe(
      imagemRedimensionada(azul, { width: 200 }),
    );
    const adicionar = [...(barra?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes("Adicionar"),
    );
    await tocar(adicionar);
    expect(triggerFlyingCartAnimation).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      imagemRedimensionada(azul, { width: 200 }),
    );
  });

  it("tocar só na cor leva a galeria para a foto dela", async () => {
    await montar();
    expect(fotoAtiva()).toBe(1);

    await tocar(opcao("Verde"));

    // Sem o conserto a escolha era parcial (sem linha completa) e a galeria
    // ficava na foto 1.
    expect(fotoAtiva()).toBe(3);
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: LARGURA * 2 }),
    );

    await tocar(opcao("Azul"));
    expect(fotoAtiva()).toBe(2);
  });

  it("escolher o tamanho depois, numa linha sem foto, não tira a galeria da foto da cor", async () => {
    await montar();
    await tocar(opcao("Verde"));
    expect(fotoAtiva()).toBe(3);

    // "Verde / P" não tem foto própria: continua valendo a foto da cor.
    await tocar(opcao("P"));
    expect(fotoAtiva()).toBe(3);
  });

  it("foto da cor que o produto não tem entra no fim da faixa mesmo com a escolha incompleta", async () => {
    await montar(
      blusa([
        linha("Azul / P", "/so-da-azul.png"),
        linha("Azul / M"),
        linha("Verde / P"),
        linha("Verde / M"),
      ]),
    );
    expect(bolinhas()).toHaveLength(3);

    await tocar(opcao("Azul"));

    expect(bolinhas()).toHaveLength(4);
    expect(fotoAtiva()).toBe(4);
    const fotos = [
      ...hospedeiro.querySelectorAll<HTMLImageElement>(
        "img.main-product-image",
      ),
    ];
    expect(fotos[3]?.getAttribute("src")).toBe("/so-da-azul.png");
  });

  it("cor sem foto em linha nenhuma não puxa a galeria", async () => {
    // Só a Azul tem foto; a Verde não tem em linha nenhuma.
    await montar(
      blusa([
        linha("Azul / P", "/f2.png"),
        linha("Azul / M"),
        linha("Verde / P"),
        linha("Verde / M"),
      ]),
    );
    await tocar(bolinhas()[0]);
    scrollTo.mockClear();

    await tocar(opcao("Verde"));

    expect(fotoAtiva()).toBe(1);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
