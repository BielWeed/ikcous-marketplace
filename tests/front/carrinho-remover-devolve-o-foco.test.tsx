import type { CartItem } from "@/types";
// @vitest-environment jsdom
// Remover a recuperação de foco faz a lixeira desmontar com o foco no body.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const produto = (id: string): CartItem => ({
  product: {
    id,
    name: id,
    description: "",
    price: 10,
    images: [],
    category: "Teste",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  },
  quantity: 1,
});
// Animações não são o objeto desta prova: montagem e desmontagem são reais,
// sem o agendador de frames do framer-motion manter act() aberto no jsdom.
vi.mock("framer-motion", async (importOriginal) => {
  const real = await importOriginal<typeof import("framer-motion")>();
  const { createElement, forwardRef } = await import("react");
  const motion = Object.fromEntries(
    ["div", "span", "button"].map((tag) => [
      tag,
      forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
        const dom = { ...props };
        for (const chave of [
          "initial",
          "animate",
          "exit",
          "transition",
          "variants",
          "custom",
          "layout",
          "whileTap",
          "whileHover",
        ]) {
          // eslint-disable-next-line security/detect-object-injection -- teste: entrada fixa, sem dado de usuário
          delete dom[chave];
        }
        return createElement(tag, { ...dom, ref });
      }),
    ]),
  );
  return {
    ...real,
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    MotionConfig: ({ children }: { children: React.ReactNode }) => children,
    usePresence: () => [true, vi.fn()],
  };
});
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingFee: 10, freeShippingMin: 0 } }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [],
    getFreeShippingEligibleProducts: () => [],
  }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [],
    shippingFee: 10,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    selectedShippingOption: null,
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ fetchUserOrders: vi.fn().mockResolvedValue([]) }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => null,
}));
vi.mock("@/components/ui/custom/CartFooterSummary", () => ({
  CartFooterSummary: () => null,
}));
vi.mock("@/components/ui/custom/OrderList", () => ({ OrderList: () => null }));
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: () => null,
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.append(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});
const lixeira = (nome: string) =>
  hospedeiro.querySelector<HTMLButtonElement>(
    `[aria-label="Remover ${nome}"]`,
  )!;
async function montar(itens: CartItem[]) {
  const { CartView } = await import("@/views/customer/CartView");
  function Carrinho() {
    const [cart, setCart] = useState(itens);
    return (
      <CartView
        cart={cart}
        onNavigate={vi.fn()}
        onRemove={(id, variacao) =>
          setCart((atual) =>
            atual.filter(
              (item) => item.product.id !== id || item.variantId !== variacao,
            ),
          )
        }
      />
    );
  }
  await act(async () => raiz.render(<Carrinho />));
}
async function remover(nome: string, moverDurante?: () => void) {
  const alvo = lixeira(nome);
  expect(alvo).toBeTruthy();
  act(() => alvo.focus());
  // O navegador aciona click ao ativar um botão com Enter/Espaço.
  act(() => alvo.click());
  moverDurante?.();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
}

describe("CartView + CartItemsList — lixeira preserva o lugar do teclado", () => {
  it.each([
    ["A", "B"],
    ["B", "C"],
    ["C", "B"],
  ])("remover %s foca a lixeira de %s", async (sai, destino) => {
    await montar(["A", "B", "C"].map(produto));
    await remover(sai);
    expect(lixeira(sai)).toBeNull();
    expect(document.activeElement).toBe(lixeira(destino));
  });
  it("o último produto leva o foco à região do carrinho vazio", async () => {
    await montar([produto("A")]);
    await remover("A");
    expect(hospedeiro.textContent).toContain("Seu carrinho está vazio");
    const foco = document.activeElement as HTMLElement;
    expect(foco === document.body).toBe(false);
    expect(foco.textContent).toContain("Seu carrinho está vazio");
  });
  it("duas variações do mesmo produto continuam sendo destinos distintos", async () => {
    const base = produto("Blusa");
    await montar([
      { ...base, variantId: "azul", variantNames: "Cor: Azul" },
      { ...base, variantId: "verde", variantNames: "Cor: Verde" },
    ]);
    await remover("Blusa (Cor: Azul)");
    expect(document.activeElement).toBe(lixeira("Blusa (Cor: Verde)"));
  });
  it("não rouba o foco movido durante os 300ms de remoção", async () => {
    await montar(["A", "B", "C"].map(produto));
    await remover("A", () => act(() => lixeira("C").focus()));
    expect(document.activeElement).toBe(lixeira("C"));
  });
});
