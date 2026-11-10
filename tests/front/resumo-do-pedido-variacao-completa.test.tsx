// @vitest-environment jsdom
// Harness do checkout-resumo-foto-da-cor-escolhida.test.tsx.
// jsdom não mede quebra de linha: a classe é o contrato de apresentação.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Product } from "@/types";

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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const variacao = "Cor: Azul marinho / Tamanho: GG / Voltagem: 220V";
const produto: Product = {
  id: "produto-teste",
  name: "Produto de teste",
  description: "",
  price: 50,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
let slotDoHeader: HTMLDivElement;

beforeEach(async () => {
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
  });
  const { HEADER_CENTER_SLOT_ID } = await import(
    "@/components/ui/custom/Header"
  );
  slotDoHeader = document.createElement("div");
  slotDoHeader.id = HEADER_CENTER_SLOT_ID;
  document.body.appendChild(slotDoHeader);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  slotDoHeader.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("CheckoutView mostra a variação completa no resumo sem reticências", async () => {
  const { CheckoutView } = await import("@/views/customer/CheckoutView");
  await act(async () => {
    raiz.render(
      <CheckoutView
        cart={[{ product: produto, quantity: 1, variantNames: variacao }]}
        subtotal={50}
        shipping={0}
        total={50}
        onNavigate={vi.fn()}
        onSetBackOverride={vi.fn()}
      />,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
  const gatilho = slotDoHeader.querySelector<HTMLButtonElement>(
    "button[aria-expanded]",
  );
  expect(gatilho).not.toBeNull();
  await act(async () => gatilho!.click());

  const painel = document.body.querySelector(
    '[role="dialog"][aria-label="Resumo do pedido"]',
  );
  expect(painel).not.toBeNull();
  const textoDaVariacao = [...painel!.querySelectorAll("p")].find(
    (p) => p.textContent === variacao,
  );
  expect(textoDaVariacao).toBeDefined();
  expect(textoDaVariacao!.textContent).toBe(variacao);
  expect(textoDaVariacao!.classList.contains("truncate")).toBe(false);
  expect(textoDaVariacao!.classList.contains("break-words")).toBe(true);
});
