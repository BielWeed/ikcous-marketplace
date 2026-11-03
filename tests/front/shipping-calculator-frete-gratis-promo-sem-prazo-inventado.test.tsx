// @vitest-environment jsdom
//
// FRETE GRÁTIS POR PRODUTO NÃO PROMETE PRAZO QUE NINGUÉM COTOU (caça, achado c1).
//
// A edge devolve o atalho `free-shipping-promo` (provider "free") com
// `deliveryDays: 3` fixo, sem consultar transportadora alguma. A tela
// escrevia "Entrega em até 3 dias úteis" para qualquer CEP do Brasil. O
// preço grátis é real; o prazo, não — então a tela não mostra prazo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product, ShippingOption } from "@/types";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { freeShippingMin: 0 }, isLoaded: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROMO: ShippingOption = {
  id: "free-shipping-promo",
  name: "Frete Grátis (Promoção)",
  price: 0,
  deliveryDays: 3,
  provider: "free",
};
const PAC: ShippingOption = {
  id: "melhorenvio-pac",
  name: "PAC",
  price: 41.9,
  deliveryDays: 3,
  provider: "melhor_envio",
};

const CARRINHO: CartItem[] = [
  {
    product: {
      id: "p1",
      name: "Blusa",
      description: "",
      price: 100,
      images: [],
      category: "Roupas",
      stock: 5,
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: true,
      createdAt: new Date(0).toISOString(),
    } as Product,
    quantity: 1,
  },
];

describe("ShippingCalculator e o prazo do frete grátis por produto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    invoke.mockReset();
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montar(
    opcoes: ShippingOption[],
    escolhida: ShippingOption,
    resumo: boolean,
  ) {
    invoke.mockResolvedValue({ data: { options: opcoes }, error: null });
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={CARRINHO}
          selectedOption={escolhida}
          onSelectOption={() => {}}
          cepDestino="69000000"
          modoResumo={resumo}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  it("resumo da opção escolhida: sem prazo inventado no frete grátis", async () => {
    await montar([PROMO], PROMO, true);
    expect(hospedeiro.textContent).toContain("Frete Grátis (Promoção)");
    expect(hospedeiro.textContent).not.toContain("dias úteis");
  });

  it("lista de opções: sem prazo no grátis; o prazo cotado de verdade continua", async () => {
    await montar([PROMO, PAC], PAC, false);
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Frete Grátis (Promoção)");
    // o único "até 3 dias úteis" que sobra é o da PAC, cotada de verdade
    expect(texto.match(/até 3 dias úteis/g)?.length).toBe(1);
  });
});
