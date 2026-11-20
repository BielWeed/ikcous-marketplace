// @vitest-environment jsdom
import { act, useCallback, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 10, freeShippingMin: 0, enableReviews: false },
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [],
    getFreeShippingEligibleProducts: () => [],
  }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => {
    const [cart, setCart] = useState<CartItem[]>([]);
    const clearCart = useCallback(() => setCart([]), []);
    return {
      cart,
      shippingFee: 10,
      updateQuantity: vi.fn(),
      removeFromCart: vi.fn(),
      clearCart,
      selectedShippingOption: null,
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ fetchUserOrders: vi.fn().mockResolvedValue([]) }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("@/components/ui/custom/OrderList", () => ({
  OrderList: () => <div data-testid="pedidos" />,
}));
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: () => <div data-testid="busca-pedido" />,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <div data-testid="carrinho-vazio" />,
}));

// @ts-expect-error flag interna do React, mesmo padrão de limpar-tudo-limpa-de-verdade.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

it.each([
  { key: "ArrowLeft", altKey: true },
  { key: "ArrowRight", ctrlKey: true },
])("preserva o atalho com $key e modificador", async (atalho) => {
  const { CartView } = await import("@/views/customer/CartView");
  const onNavigate = vi.fn();
  await act(async () => raiz.render(<CartView onNavigate={onNavigate} />));
  const carrinho = hospedeiro.querySelector<HTMLButtonElement>("#tab-cart")!;
  const pedidos = hospedeiro.querySelector<HTMLButtonElement>("#tab-orders")!;
  carrinho.focus();

  const evento = new KeyboardEvent("keydown", {
    ...atalho,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    carrinho.dispatchEvent(evento);
  });

  expect(evento.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(carrinho);
  expect(carrinho.getAttribute("aria-selected")).toBe("true");
  expect(pedidos.getAttribute("aria-selected")).toBe("false");
  expect(onNavigate).not.toHaveBeenCalled();
});

it("só a aba ativa recebe Tab; setas, Home e End movem o foco e selecionam", async () => {
  const { CartView } = await import("@/views/customer/CartView");
  const onNavigate = vi.fn();
  await act(async () => raiz.render(<CartView onNavigate={onNavigate} />));
  const carrinho = hospedeiro.querySelector<HTMLButtonElement>("#tab-cart")!;
  const pedidos = hospedeiro.querySelector<HTMLButtonElement>("#tab-orders")!;

  expect(carrinho.tabIndex).toBe(0);
  expect(pedidos.tabIndex).toBe(-1);
  carrinho.focus();

  for (const [tecla, ativa, inativa, rota] of [
    ["ArrowRight", pedidos, carrinho, "orders"],
    ["ArrowRight", carrinho, pedidos, "cart"],
    ["ArrowLeft", pedidos, carrinho, "orders"],
    ["Home", carrinho, pedidos, "cart"],
    ["End", pedidos, carrinho, "orders"],
  ] as const) {
    const evento = new KeyboardEvent("keydown", {
      key: tecla,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      document.activeElement?.dispatchEvent(evento);
    });
    expect(evento.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(ativa);
    expect(ativa.getAttribute("aria-selected")).toBe("true");
    expect(inativa.getAttribute("aria-selected")).toBe("false");
    expect(ativa.tabIndex).toBe(0);
    expect(inativa.tabIndex).toBe(-1);
    expect(onNavigate).toHaveBeenLastCalledWith(rota);
  }
});
