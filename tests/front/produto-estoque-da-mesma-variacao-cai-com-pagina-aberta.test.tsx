// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

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

const vermelha: ProductVariant = {
  id: "vermelha-teste",
  productId: "produto-teste",
  name: "Cor",
  value: "Vermelha",
  stockIncrement: 10,
  active: true,
};
const azul: ProductVariant = {
  ...vermelha,
  id: "azul-teste",
  value: "Azul",
};
const produto: Product = {
  id: "produto-teste",
  name: "Camiseta",
  description: "Produto de teste",
  price: 10,
  images: ["/foto.png"],
  category: "roupas",
  stock: 20,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-11-10T12:00:00Z",
  variants: [vermelha, azul],
};

it("estoque da mesma opção cai de 10 para 2: reduz as 5 unidades exibidas e enviadas", async () => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("CSS", { escape: (valor: string) => valor });
  // A preferência real evita spans de animação antigos no DOM do jsdom.
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: consulta.includes("prefers-reduced-motion"),
    media: consulta,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  }));
  const elemento = document.createElement("div");
  document.body.appendChild(elemento);
  const raiz = createRoot(elemento);
  const adicionar = vi.fn();
  const { ProductView } = await import("@/views/customer/ProductView");
  const props = {
    isFavorite: false,
    onToggleFavorite: vi.fn(),
    onAddToCart: adicionar,
    onBack: vi.fn(),
  };
  async function tocar(botao: HTMLButtonElement | undefined | null) {
    expect(botao).toBeTruthy();
    await act(async () => {
      botao?.click();
    });
  }
  function quantidadeExibida() {
    // Região live real: não confunde a quantidade com preço ou estoque.
    return elemento.querySelector(
      '[role="group"][aria-label^="Quantidade"] [aria-live="polite"]',
    )?.textContent;
  }
  try {
    await act(async () => {
      raiz.render(<ProductView {...props} product={produto} />);
    });
    await tocar(
      [...elemento.querySelectorAll("button")].find(
        (b) => b.querySelector("span")?.textContent === "Vermelha",
      ),
    );
    expect(
      elemento.querySelector('button[aria-pressed="true"]')?.textContent,
    ).toContain("Vermelha");
    for (let i = 0; i < 4; i++) {
      await tocar(
        elemento.querySelector<HTMLButtonElement>(
          'button[aria-label="Aumentar quantidade"]',
        ),
      );
    }
    expect(quantidadeExibida()).toBe("5");
    // Mesmo root, callbacks e ids; só o estoque muda, sem trocar a opção.
    await act(async () => {
      raiz.render(
        <ProductView
          {...props}
          product={{
            ...produto,
            variants: [{ ...vermelha, stockIncrement: 2 }, azul],
          }}
        />,
      );
    });
    expect(quantidadeExibida()).toBe("2");
    await tocar(
      [...elemento.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Adicionar ao Carrinho"),
      ),
    );
    expect(adicionar).toHaveBeenCalledTimes(1);
    expect(adicionar).toHaveBeenCalledWith(
      2,
      "vermelha-teste",
      expect.any(String),
    );
  } finally {
    act(() => raiz.unmount());
    elemento.remove();
    document.getElementById("product-structured-data")?.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  }
});
