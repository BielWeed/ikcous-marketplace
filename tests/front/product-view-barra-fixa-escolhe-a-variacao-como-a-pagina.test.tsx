// @vitest-environment jsdom
//
// A barra de compra FIXA de baixo (aparece ao rolar, no celular) tem o
// próprio menu de variações (CompactVariantDropdown). Achado do revisor no
// Chromium a 375px: escolher a Vermelha (10), subir para 5, rolar até a barra
// e trocar para a Azul (2) PELA BARRA deixava a quantidade em 5, sem o aviso
// "Só restam 2", mandava onAddToCart(5, "v-azul") e a galeria não andava até
// a foto da Azul. A escolha pela barra tem de ser a MESMA dos botões da
// página -- só não desmarca ao tocar de novo (o menu nunca desmarcou).
//
// O hospedeiro é um <main> real: o efeito que liga `scrolled` (a barra só
// existe com `scrolled=true`) só se inscreve com `document.querySelector
// ("main")` -- mesmo recurso de product-view-barra-fixa-preco-promocional.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const avisar = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    warning: (...args: unknown[]) => avisar(...args),
    success: vi.fn(),
    error: vi.fn(),
  },
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

function cor(
  id: string,
  valor: string,
  estoque: number,
  imageUrl?: string,
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
    images: ["/f1.png", "/f2.png"],
    category: "roupas",
    stock: 12,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    variants,
  };
}

describe("ProductView — a barra fixa escolhe a variação como a página", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;
  let adicionarAoCarrinho: ReturnType<
    typeof vi.fn<
      (quantity: number, variantId?: string, variantNames?: string) => void
    >
  >;

  beforeEach(() => {
    avisar.mockClear();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    hospedeiro = document.createElement("main");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    adicionarAoCarrinho = vi.fn();
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

  async function tocar(el: Element | null | undefined) {
    expect(el).toBeTruthy();
    await act(async () => {
      (el as HTMLElement).click();
    });
  }

  const barra = () =>
    document.querySelector<HTMLElement>(".bottom-docked-navigation");

  /** Botão de variação DA PÁGINA (os da barra não têm aria-pressed). */
  function opcaoDaPagina(valor: string) {
    const span = [...hospedeiro.querySelectorAll("button span")].find(
      (el) => el.textContent === valor,
    );
    return span?.closest("button") as HTMLButtonElement;
  }

  /** Abre o menu da barra (o botão que mostra a cor escolhida) e devolve o item. */
  async function itemDoMenuDaBarra(escolhidaAgora: string, valor: string) {
    const gatilho = [...(barra()?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === escolhidaAgora,
    );
    await tocar(gatilho);
    // O item do menu vem DEPOIS do gatilho no DOM (que também tem um <span>
    // com o mesmo texto quando a cor aberta é a escolhida): o último vale.
    const candidatos = [...(barra()?.querySelectorAll("button span") ?? [])];
    const item = candidatos.filter((el) => el.textContent === valor).at(-1);
    return item?.closest("button") as HTMLButtonElement;
  }

  async function comprarPelaBarra() {
    const botoes = barra()?.querySelectorAll("button") ?? [];
    await tocar(botoes[botoes.length - 1]);
  }

  it("a barra existe com a página rolada (o teste está de fato no caminho da barra)", async () => {
    await montar(
      blusa([cor("v-verm", "Vermelha", 10), cor("v-azul", "Azul", 2)]),
    );
    expect(barra()).not.toBeNull();
  });

  it("5 do vermelho (10), trocar para o azul (2) PELA BARRA: vira 2, avisa e manda 2", async () => {
    await montar(
      blusa([cor("v-verm", "Vermelha", 10), cor("v-azul", "Azul", 2)]),
    );

    await tocar(opcaoDaPagina("Vermelha"));
    const mais = document.querySelector(
      "button[aria-label='Aumentar quantidade']",
    );
    for (let i = 0; i < 4; i++) await tocar(mais);
    expect(avisar).not.toHaveBeenCalled();

    const azul = await itemDoMenuDaBarra("Vermelha", "Azul");
    await tocar(azul);

    await comprarPelaBarra();
    expect(adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    expect(adicionarAoCarrinho.mock.calls[0][0]).toBe(2);
    expect(adicionarAoCarrinho.mock.calls[0][1]).toBe("v-azul");
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(String(avisar.mock.calls[0][0])).toBe("Só restam 2");
  });

  it("escolher pela barra uma cor com foto leva a galeria até a foto dela", async () => {
    await montar(
      blusa([
        cor("v-verm", "Vermelha", 10, "/f1.png"),
        cor("v-azul", "Azul", 5, "/f2.png"),
      ]),
    );
    await tocar(opcaoDaPagina("Vermelha"));
    const ativa = () =>
      [...hospedeiro.querySelectorAll("button[aria-current='true']")].map((b) =>
        b.getAttribute("aria-label"),
      );
    expect(ativa()).toContain("Foto 1 de 2");

    await tocar(await itemDoMenuDaBarra("Vermelha", "Azul"));

    expect(ativa()).toContain("Foto 2 de 2");
  });

  it("variação esgotada fica desabilitada no menu da barra", async () => {
    await montar(
      blusa([cor("v-verm", "Vermelha", 10), cor("v-preta", "Preta", 0)]),
    );
    await tocar(opcaoDaPagina("Vermelha"));

    const preta = await itemDoMenuDaBarra("Vermelha", "Preta");
    expect(preta.disabled).toBe(true);
    await tocar(preta);

    expect(opcaoDaPagina("Preta").getAttribute("aria-pressed")).toBe("false");
    expect(opcaoDaPagina("Vermelha").getAttribute("aria-pressed")).toBe("true");
  });

  it("o menu da barra NÃO desmarca ao tocar na já escolhida (só a página desmarca)", async () => {
    await montar(
      blusa([cor("v-verm", "Vermelha", 10), cor("v-azul", "Azul", 2)]),
    );
    await tocar(opcaoDaPagina("Azul"));

    await tocar(await itemDoMenuDaBarra("Azul", "Azul"));

    expect(opcaoDaPagina("Azul").getAttribute("aria-pressed")).toBe("true");
  });
});
