import type { Product } from "@/types";
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
    },
    isLoaded: true,
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [],
    cartTotal: 0,
    shippingFee: 0,
    clearCart: vi.fn(),
    addToCart: vi.fn(),
    shippingCep: "",
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
    selectedShippingOption: { id: "opcao-padrao", name: "Padrão" },
    freteIndefinido: false,
  }),
}));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("CheckoutView deixa o círculo neutro quando a miniatura do botão falha", async () => {
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => armazem.set(chave, valor),
    removeItem: (chave: string) => armazem.delete(chave),
  });
  const { HEADER_CENTER_SLOT_ID } = await import(
    "@/components/ui/custom/Header"
  );
  const { CheckoutView } = await import("@/views/customer/CheckoutView");
  const slot = document.createElement("div");
  slot.id = HEADER_CENTER_SLOT_ID;
  const hospedeiro = document.createElement("div");
  document.body.append(slot, hospedeiro);
  const raiz = createRoot(hospedeiro);
  const produto: Product = {
    id: "vestido",
    name: "Vestido",
    description: "",
    price: 100,
    images: ["https://exemplo.supabase.co/storage/v1/object/public/fotos/vestido.jpg"],
    category: "Vestidos",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "",
  };
  try {
    await act(async () =>
      raiz.render(
        <CheckoutView
          cart={[{ product: produto, quantity: 1 }]}
          subtotal={100}
          shipping={0}
          total={100}
          onNavigate={vi.fn()}
          onSetBackOverride={vi.fn()}
        />,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    const botao = slot.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    const foto = botao.querySelector("img")!;
    expect(foto).not.toBeNull();
    await act(async () => foto.dispatchEvent(new Event("error")));
    expect(foto.src).toContain("/object/public/");
    expect(foto.hidden).toBe(false);
    await act(async () => foto.dispatchEvent(new Event("error")));
    expect(foto.hidden || !botao.contains(foto)).toBe(true);
    expect(foto.parentElement?.className).toContain("size-6");
    expect(foto.parentElement?.className).toContain("bg-zinc-100");
    expect(botao.disabled).toBe(false);
  } finally {
    act(() => raiz.unmount());
    hospedeiro.remove();
    slot.remove();
    vi.unstubAllGlobals();
  }
});
