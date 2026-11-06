// @vitest-environment jsdom
//
// O resumo do pedido (painel aberto pelo gatilho do topo) mostrava SEMPRE a
// primeira foto do produto: duas linhas do mesmo produto em cores diferentes
// saíam com a mesma miniatura. Agora cada linha mostra a foto da cor escolhida
// (e cai na do produto quando a cor não tem foto). Só APRESENTAÇÃO: preço,
// quantidade e total não mudam.
//
// Harness herdado de tests/front/checkout-summary-bar.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product } from "@/types";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

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

const FOTO_DO_PRODUTO = "https://loja.example/camiseta.jpg";
const FOTO_AZUL = "https://loja.example/camiseta-azul.jpg";
const FOTO_ROSA = "https://loja.example/camiseta-rosa.jpg";

const camiseta: Product = {
  id: "prod-camiseta",
  name: "Camiseta Teste",
  description: "",
  price: 50,
  images: [FOTO_DO_PRODUTO],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
  variants: [
    {
      id: "var-azul",
      productId: "prod-camiseta",
      name: "Cor",
      value: "Azul",
      stockIncrement: 5,
      active: true,
      imageUrl: FOTO_AZUL,
    },
    {
      id: "var-rosa",
      productId: "prod-camiseta",
      name: "Cor",
      value: "Rosa",
      stockIncrement: 5,
      active: true,
      imageUrl: FOTO_ROSA,
    },
    {
      id: "var-verde",
      productId: "prod-camiseta",
      name: "Cor",
      value: "Verde",
      stockIncrement: 5,
      active: true,
    },
  ],
};

async function esperarBarraMontar() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
}

describe("CheckoutView — o resumo do pedido mostra a foto da cor escolhida", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  beforeEach(async () => {
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
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
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    slotDoHeader.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function abrirOResumo(cart: CartItem[], subtotal: number) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={cart}
          subtotal={subtotal}
          shipping={0}
          total={subtotal}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperarBarraMontar();
    const gatilho = [...slotDoHeader.querySelectorAll("button")].find((b) =>
      b.hasAttribute("aria-expanded"),
    ) as HTMLButtonElement;
    await act(async () => {
      gatilho.click();
    });
    const painel = document.body.querySelector(
      '[role="dialog"][aria-label="Resumo do pedido"]',
    );
    expect(painel).not.toBeNull();
    return [...painel!.querySelectorAll("li")].map((li) => ({
      foto: li.querySelector("img")?.getAttribute("src"),
      texto: li.textContent ?? "",
    }));
  }

  it("duas linhas do mesmo produto em cores diferentes mostram fotos diferentes", async () => {
    const linhas = await abrirOResumo(
      [
        {
          product: camiseta,
          quantity: 1,
          variantId: "var-azul",
          variantNames: "Cor: Azul",
        },
        {
          product: camiseta,
          quantity: 2,
          variantId: "var-rosa",
          variantNames: "Cor: Rosa",
        },
      ],
      150,
    );
    expect(linhas.map((l) => l.foto)).toEqual([FOTO_AZUL, FOTO_ROSA]);
    // O dinheiro da linha segue igual: quantidade × preço.
    expect(linhas[1].texto).toContain("2 × R$ 50,00");
  });

  it("cor sem foto própria e linha sem variação seguem com a foto do produto", async () => {
    const linhas = await abrirOResumo(
      [
        {
          product: camiseta,
          quantity: 1,
          variantId: "var-verde",
          variantNames: "Cor: Verde",
        },
        { product: { ...camiseta, variants: [] }, quantity: 1 },
      ],
      100,
    );
    expect(linhas.map((l) => l.foto)).toEqual([
      FOTO_DO_PRODUTO,
      FOTO_DO_PRODUTO,
    ]);
  });
});
