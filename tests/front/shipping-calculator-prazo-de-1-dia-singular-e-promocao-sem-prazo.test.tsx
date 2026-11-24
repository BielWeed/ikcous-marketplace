// @vitest-environment jsdom
//
// O prazo do frete no carrinho/checkout, nos dois pontos que o teste vizinho
// (shipping-calculator-entrega-propria-prazo-em-dias) deixava passar porque
// confere por PEDAÇO de texto: "Entrega em até 1 dia" também está contido em
// "Entrega em até 1 dias".
//  - 1 dia é singular nas duas famílias: entrega própria "1 dia", transportadora
//    "1 dia útil" (a transportadora de 1 dia nunca era conferida);
//  - o frete grátis por produto (id "free-shipping-promo" OU provedor "free")
//    não promete prazo nenhum: o "3 dias" fixo da edge não foi calculado por
//    ninguém. Cada sinal é provado sozinho.
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

const opcao = (parcial: Partial<ShippingOption>): ShippingOption => ({
  id: "melhorenvio-pac",
  name: "PAC",
  price: 41.9,
  deliveryDays: 3,
  provider: "melhor_envio",
  ...parcial,
});

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
      freeShipping: false,
      createdAt: new Date(0).toISOString(),
    } as Product,
    quantity: 1,
  },
];

describe("ShippingCalculator — singular de 1 dia e promoção sem prazo", () => {
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

  async function montar(unica: ShippingOption): Promise<string> {
    invoke.mockResolvedValue({ data: { options: [unica] }, error: null });
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={CARRINHO}
          selectedOption={unica}
          onSelectOption={() => {}}
          cepDestino="38500000"
          modoResumo={false}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  it("entrega própria de 1 dia diz '1 dia', nunca '1 dias'", async () => {
    const texto = await montar(
      opcao({
        id: "local-delivery",
        name: "Entrega Local",
        price: 10,
        deliveryDays: 1,
        provider: "local",
      }),
    );
    expect(texto).toContain("Entrega em até 1 dia");
    expect(texto).not.toContain("1 dias");
  });

  it("transportadora de 1 dia diz '1 dia útil', nunca '1 dias úteis'", async () => {
    const texto = await montar(opcao({ deliveryDays: 1 }));
    expect(texto).toContain("Entrega em até 1 dia útil");
    expect(texto).not.toContain("1 dias");
  });

  it("controle: transportadora de 2 dias segue no plural", async () => {
    const texto = await montar(opcao({ deliveryDays: 2 }));
    expect(texto).toContain("Entrega em até 2 dias úteis");
  });

  it.each([
    ["só pelo id da promoção", { id: "free-shipping-promo" }],
    ["só pelo provedor 'free'", { provider: "free" }],
  ])(
    "frete grátis por produto reconhecido %s não promete prazo",
    async (_caso, sinal) => {
      const texto = await montar(
        opcao({
          name: "Frete Grátis (Promoção)",
          price: 0,
          deliveryDays: 3,
          ...sinal,
        }),
      );
      expect(texto).toContain("Frete Grátis (Promoção)");
      expect(texto).not.toContain("Entrega em até");
      expect(texto).not.toContain("3 dias");
    },
  );
});
