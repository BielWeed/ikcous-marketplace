// @vitest-environment jsdom
//
// Lote 230: a folha de opções que abre no card do produto (tamanho/cor, nas
// listas da loja) também fecha com o Voltar do celular, sem tirar a cliente
// da tela. Molde de mocks: card-so-comemora-quando-entrou-no-carrinho.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    message: vi.fn(),
    custom: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/utils/cartAnimation", () => ({
  triggerFlyingCartAnimation: vi.fn(),
  pontoDeSaidaVisivel: () => true,
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { success: vi.fn(), medium: vi.fn(), light: vi.fn(), heavy: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const variantes: ProductVariant[] = ["P", "M"].map((valor) => ({
  id: `var-${valor}`,
  productId: "prod-caderno",
  name: "Tamanho",
  value: valor,
  stockIncrement: 5,
  active: true,
}));

const produto: Product = {
  id: "prod-caderno",
  name: "Caderno Bom",
  description: "Descrição de teste",
  price: 50,
  images: ["https://example.com/img.png"],
  category: "papelaria",
  stock: 99,
  sold: 3,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  variants: variantes,
};

const esperar = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));

describe("lote 230 — folha de opções do card e o Voltar do celular", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: false,
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    globalThis.history.replaceState({ view: "home" }, "", "/");
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  const folha = () =>
    document.querySelector('[data-testid="product-card-options-sheet"]');

  async function abrirFolha() {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={vi.fn()}
          showRating={false}
          onAddToCartWithVariants={vi.fn(() => 1)}
        />,
      );
    });
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[data-testid="product-card-action"]',
        )
        ?.click();
    });
    expect(folha()).not.toBeNull();
  }

  it("o Voltar fecha a folha do card e a tela não troca", async () => {
    await abrirFolha();
    expect(globalThis.history.state?.folhaDePolitica).toBe(true);

    await act(async () => {
      globalThis.history.back();
      await esperar();
    });

    expect(folha()).toBeNull();
    expect(globalThis.location.pathname).toBe("/");
  });
});
