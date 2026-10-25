// @vitest-environment jsdom
//
// UI-170, achado C1: a lixeira da linha do carrinho é o ÚNICO fluxo que pede o
// aviso com "Desfazer". O CartView repassa `comDesfazer` ao `removeFromCart` do
// contexto; quem injeta o próprio `onRemove` (prop) continua recebendo só o
// produto e a variação, como sempre.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";

const removeFromCart = vi.fn();

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 15, freeShippingMin: 0 },
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    getFreeShippingEligibleProducts: () => [],
  }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [],
    shippingFee: 0,
    freteGratis: false,
    updateQuantity: vi.fn(),
    removeFromCart,
    clearCart: vi.fn(),
    selectedShippingOption: null,
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ fetchUserOrders: vi.fn() }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div data-testid="calculadora" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const item: CartItem = {
  product: {
    id: "prod-8",
    name: "Produto de oito",
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 20,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
  },
  quantity: 8,
};

describe("CartView — a lixeira da linha pede o aviso com Desfazer", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    removeFromCart.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function tocarNaLixeira() {
    const lixeira = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Remover item"]',
    );
    if (!lixeira) throw new Error("a lixeira da linha não apareceu");
    await act(async () => {
      lixeira.click();
      // O CartView espera a animação de saída (300 ms) antes de remover.
      await new Promise((r) => setTimeout(r, 400));
    });
  }

  it("sem onRemove injetado, remove pelo contexto com comDesfazer", async () => {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView cart={[item]} onNavigate={() => {}} />);
    });

    await tocarNaLixeira();

    expect(removeFromCart).toHaveBeenCalledTimes(1);
    expect(removeFromCart).toHaveBeenCalledWith("prod-8", undefined, {
      comDesfazer: true,
    });
  });

  it("com onRemove injetado, ele recebe só o produto e a variação (contrato de antes)", async () => {
    const { CartView } = await import("@/views/customer/CartView");
    const onRemove = vi.fn();
    await act(async () => {
      raiz.render(
        <CartView cart={[item]} onNavigate={() => {}} onRemove={onRemove} />,
      );
    });

    await tocarNaLixeira();

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove.mock.calls.at(0)).toEqual(["prod-8", undefined]);
    expect(removeFromCart).not.toHaveBeenCalled();
  });
});
