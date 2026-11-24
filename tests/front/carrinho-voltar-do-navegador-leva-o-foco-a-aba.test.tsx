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

it.each([false, true])(
  "ao voltar, sincroniza a aba sem roubar o foco de outro controle (fora da faixa: %s)",
  async (focoForaDaFaixa) => {
    const { CartView } = await import("@/views/customer/CartView");
    const onNavigate = (view: string) => {
      globalThis.history.pushState(null, "", `/${view}`);
    };
    // Reproduz só a fronteira com o App: muda initialTab sem remontar CartView.
    const renderizar = (aba: "cart" | "orders") =>
      raiz.render(
        <>
          <input aria-label="Busca da loja" />
          <CartView initialTab={aba} onNavigate={onNavigate} />
        </>,
      );
    globalThis.history.replaceState(null, "", "/cart");
    await act(async () => renderizar("cart"));
    const carrinho = hospedeiro.querySelector<HTMLButtonElement>("#tab-cart")!;
    const pedidos = hospedeiro.querySelector<HTMLButtonElement>("#tab-orders")!;
    const busca = hospedeiro.querySelector<HTMLInputElement>("input")!;
    carrinho.focus();

    await act(async () => {
      carrinho.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(globalThis.location.pathname).toBe("/orders");
    await act(async () => renderizar("orders"));
    expect(pedidos.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(pedidos);
    if (focoForaDaFaixa) busca.focus();

    const percorrerHistorico = async (direcao: "back" | "forward") => {
      await act(async () => {
        const navegou = new Promise<void>((resolve) => {
          globalThis.addEventListener("popstate", () => resolve(), {
            once: true,
          });
        });
        if (direcao === "back") globalThis.history.back();
        else globalThis.history.forward();
        await navegou;
        renderizar(
          globalThis.location.pathname === "/cart" ? "cart" : "orders",
        );
      });
    };

    await percorrerHistorico("back");
    expect(globalThis.location.pathname).toBe("/cart");
    expect(carrinho.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(focoForaDaFaixa ? busca : carrinho);

    await percorrerHistorico("forward");
    expect(globalThis.location.pathname).toBe("/orders");
    expect(pedidos.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(focoForaDaFaixa ? busca : pedidos);
  },
);
