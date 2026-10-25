// @vitest-environment jsdom
// Vitrine (25/10), celular de 320 px: o botão "Escolher opções" do card saía
// "ESCOLHER …" (texto cortado) e o exemplo do CEP "00000-000" saía
// "00000-00C". Em telas abaixo de 360 px o botão aperta o respiro e o espaçamento
// das letras (e dispensa o ícone), e o CEP usa fonte menor. Do 360 px para cima
// nada muda. jsdom NÃO calcula layout: prova-se a classe aplicada; o visual em
// navegador real não é provado por este teste.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      freeShippingMin: 350,
      enableReviews: false,
      shippingCoverage: "local",
      originCep: "38500-000",
    },
    isLoaded: true,
  }),
}));
vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: 0 }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-teste" } }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const variantes: ProductVariant[] = ["P", "M"].map((value) => ({
  id: `var-${value}`,
  productId: "prod-camiseta",
  name: "Tamanho",
  value,
  stockIncrement: 5,
  active: true,
}));

const produto: Product = {
  id: "prod-camiseta",
  name: "Camiseta",
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
  variants: variantes,
};

describe("celular estreito (< 360 px) — texto cabe", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  it("botão 'Escolher opções' aperta respiro e letras abaixo de 360 px, sem trocar o rótulo", async () => {
    const { ProductList } = await import("@/components/ui/custom/ProductList");
    await act(async () => {
      raiz.render(
        <ProductList
          products={[produto]}
          isLoading={false}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onAddToCart={() => {}}
        />,
      );
    });
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-action"]',
    )!;
    expect(botao.textContent).toContain("Escolher opções");
    expect(botao.className).toContain("max-[359px]:px-1.5");
    expect(botao.className).toContain("max-[359px]:tracking-normal");
    // O desktop e o celular comum seguem com o desenho de sempre.
    expect(botao.className).toContain("px-3");
    expect(botao.className).toContain("tracking-wider");
  });

  it("CEP usa fonte menor abaixo de 360 px e mantém os 22 px de sempre dali para cima", async () => {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(<AddressForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    });
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    const cep = document.getElementById("cep")!;
    expect(cep.getAttribute("placeholder")).toBe("00000-000");
    expect(cep.classList.contains("max-[359px]:text-[18px]")).toBe(true);
    expect(cep.classList.contains("max-[359px]:pr-10")).toBe(true);
    expect(cep.classList.contains("text-[22px]")).toBe(true);
    expect(cep.classList.contains("md:text-[22px]")).toBe(true);
  });
});
