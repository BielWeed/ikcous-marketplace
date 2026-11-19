// @vitest-environment jsdom
import type { CartItem } from "@/types";
import { act, createContext, useContext, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const { navegar, renovar } = vi.hoisted(() => ({
  navegar: vi.fn(),
  renovar: vi.fn<() => Promise<void>>(),
}));

const Carrinho = createContext<CartItem[]>([]);
const item: CartItem = {
  product: {
    id: "prod-1",
    name: "Blusa Teste",
    description: "",
    price: 100,
    images: [],
    category: "Roupas",
    stock: 1,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  },
  quantity: 1,
};
const outroItem: CartItem = {
  ...item,
  product: { ...item.product, id: "prod-2", name: "Calça Teste" },
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 10, formasPagamentoEntrega: ["pix"] },
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => {
    const cart = useContext(Carrinho);
    return {
      cart,
      cartTotal: cart.length * 100,
      shippingFee: 10,
      renovarCarrinhoPeloCatalogo: renovar,
    };
  },
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: async () => {},
    loading: false,
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ fetchUserOrders: async () => [], orders: [] }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "conta-teste" } }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: () => <div />,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div />,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => <div />,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <p>Carrinho vazio</p>,
}));

it.each([false, true])(
  "Finalizar compra após esgotar um item, com outro item disponível: %s",
  async (sobrouItem) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    navegar.mockReset();
    renovar.mockReset();
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);

    try {
      const { CartView } = await import("@/views/customer/CartView");
      let concluirReleitura = () => {};
      function Cenario() {
        const [cart, setCart] = useState(
          sobrouItem ? [item, outroItem] : [item],
        );
        renovar.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              concluirReleitura = () => {
                // A ação atualiza o estado e resolve sem esperar o React renderizar.
                setCart((atual) => atual.filter((i) => i !== item));
                resolve();
              };
            }),
        );
        return (
          <Carrinho.Provider value={cart}>
            <CartView onNavigate={navegar} />
          </Carrinho.Provider>
        );
      }

      await act(async () => {
        raiz.render(<Cenario />);
      });
      const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Finalizar Compra",
      );
      if (!botao) throw new Error("Botão Finalizar Compra não encontrado");
      await act(async () => {
        botao.click();
      });
      expect(renovar).toHaveBeenCalledTimes(1);
      expect(navegar).not.toHaveBeenCalled();

      await act(async () => {
        concluirReleitura();
      });

      if (sobrouItem) {
        expect(navegar).toHaveBeenCalledExactlyOnceWith("checkout");
      } else {
        expect(hospedeiro.textContent).toContain("Carrinho vazio");
        expect(navegar).not.toHaveBeenCalled();
      }
    } finally {
      await act(async () => raiz.unmount());
      hospedeiro.remove();
      vi.unstubAllGlobals();
    }
  },
);
