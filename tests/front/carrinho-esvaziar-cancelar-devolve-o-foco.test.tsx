// @vitest-environment jsdom
//
// Acessibilidade (13/11/2026): "Esvaziar carrinho" (aviso de 50+ produtos)
// abre a caixa de confirmação por ESTADO, sem gatilho do Radix -- então, ao
// fechar com "Manter" (ou Esc), o Radix não tinha para onde devolver o foco e
// ele caía no <body>: quem usa teclado ou leitor de tela perdia o lugar na
// tela. Agora o foco volta ao botão que abriu a caixa.
//
// Render de verdade do CartView e do AlertDialog (Radix real); só as pontas
// são dubladas. O botão que abre a caixa vive no CartItemsList, dublado aqui
// por um botão que chama o `handleClearCart` que o CartView passou.
import { act, useCallback, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";

const itemNoCarrinho: CartItem = {
  product: {
    id: "prod-1",
    name: "Blusa Teste",
    description: "",
    price: 100,
    images: [],
    category: "Roupas",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  },
  quantity: 1,
};

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
    const [cart, setCart] = useState<CartItem[]>([itemNoCarrinho]);
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

vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: ({ handleClearCart }: { handleClearCart: () => void }) => (
    <div data-testid="itens">
      <button type="button" onClick={() => handleClearCart()}>
        Esvaziar carrinho
      </button>
    </div>
  ),
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div data-testid="calculadora" />,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => <div data-testid="progresso" />,
}));
vi.mock("@/components/ui/custom/CartFooterSummary", () => ({
  CartFooterSummary: () => <div data-testid="rodape" />,
}));
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

describe("CartView — fechar a caixa 'Esvaziar o carrinho' devolve o foco", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  const botaoQueAbre = () =>
    hospedeiro.querySelector<HTMLButtonElement>('[data-testid="itens"] button');
  const botaoDoDialogo = (rotulo: string) =>
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button',
      ),
    ).find((b) => b.textContent === rotulo);
  // O Radix devolve o foco num `setTimeout(0)` depois de desmontar.
  const assentar = async () => {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  };

  async function abrirACaixa() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const abre = botaoQueAbre();
    expect(abre).not.toBeNull();
    abre?.focus();
    await act(async () => {
      abre?.click();
    });
    await assentar();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    return abre as HTMLButtonElement;
  }

  it("'Manter' fecha a caixa e o foco volta ao botão que a abriu", async () => {
    const abre = await abrirACaixa();
    await act(async () => {
      botaoDoDialogo("Manter")?.click();
    });
    await assentar();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(abre);
  });

  it("Esc fecha a caixa e o foco também volta ao botão", async () => {
    const abre = await abrirACaixa();
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await assentar();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(abre);
  });

  it("controle: confirmar esvazia o carrinho e não quebra (o botão sumiu, o foco não é forçado)", async () => {
    await abrirACaixa();
    await act(async () => {
      botaoDoDialogo("Esvaziar carrinho")?.click();
    });
    await assentar();
    expect(
      hospedeiro.querySelector('[data-testid="carrinho-vazio"]'),
    ).not.toBeNull();
    expect(botaoQueAbre()).toBeNull();
  });
});
