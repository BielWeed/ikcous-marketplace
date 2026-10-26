// @vitest-environment jsdom
//
// Caça 8 (26/10/2026), item 5: formulário do convidado com rótulos zinc-400 de
// 10 px (2,56:1), erros red-500 (3,76:1), e campos de endereço sem
// preenchimento automático. Mocks no padrão de checkout-guest-cep-teclado-numerico.
import { readFileSync } from "node:fs";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingCoverage: "national", originCep: "38500-000" },
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
    cart: [
      {
        product: {
          id: "prod-1",
          name: "Produto Teste",
          description: "",
          price: 100,
          images: [],
          category: "geral",
          stock: 10,
          sold: 0,
          isActive: true,
          isBestseller: false,
          freeShipping: false,
          createdAt: new Date().toISOString(),
        },
        quantity: 1,
      },
    ],
    cartTotal: 100,
    shippingFee: 0,
    clearCart: vi.fn(),
    selectedShippingOption: null,
    shippingCep: "",
  }),
}));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CheckoutView (convidado) — rótulos, erros e preenchimento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView onNavigate={vi.fn()} onSetBackOverride={vi.fn()} />,
      );
    });
  }

  it("os rótulos do endereço do convidado têm contraste (zinc-600, não zinc-400)", async () => {
    await montar();
    for (const id of [
      "guest-cep",
      "guest-number",
      "guest-street",
      "guest-neighborhood",
      "guest-city",
      "guest-state",
      "guest-complement",
    ]) {
      const rotulo = document.querySelector(`label[for="${id}"]`);
      expect(rotulo, id).not.toBeNull();
      expect(rotulo!.className, id).toContain("text-zinc-600");
      expect(rotulo!.className, id).not.toContain("text-zinc-400");
    }
  });

  it("rua, bairro, cidade e estado pedem o preenchimento certo do navegador", async () => {
    await montar();
    const ac = (id: string) =>
      document.getElementById(id)?.getAttribute("autocomplete");
    expect(ac("guest-street")).toBe("address-line1");
    expect(ac("guest-neighborhood")).toBe("address-level3");
    expect(ac("guest-city")).toBe("address-level2");
    expect(ac("guest-state")).toBe("address-level1");
  });

  it("o CEP não é desabilitado durante a busca (não perde o foco): fora da busca não é readOnly", async () => {
    await montar();
    const cep = document.getElementById("guest-cep") as HTMLInputElement;
    expect(cep.disabled).toBe(false);
    expect(cep.readOnly).toBe(false);
    expect(cep.getAttribute("aria-busy")).toBe("false");
  });

  it("as mensagens de erro do formulário do convidado são red-700 (5,9:1), não red-500", () => {
    // Os <p> de erro só existem depois de validar; a guarda é sobre o código.
    const fonte = readFileSync("src/views/customer/CheckoutView.tsx", "utf8");
    expect(fonte).not.toContain(
      "mt-1.5 text-[10px] font-bold uppercase text-red-500",
    );
    expect(
      fonte.match(/mt-1\.5 text-\[10px\] font-bold uppercase text-red-700/g),
    ).toHaveLength(7);
  });
});
