// @vitest-environment jsdom
//
// A ENTREGA PRÓPRIA PROMETE O PRAZO NA UNIDADE DA LOJISTA (caça, achado 2).
//
// No painel a lojista digita o prazo da entrega na cidade em "dias" (campo
// "2 dias"; a prévia dela diz "chega em 2 dias"). A cliente lia "Entrega em
// até 2 dias úteis" — a frase de transportadora —, e "1 dia útil" tirava a
// promessa de entrega no fim de semana que a lojista fazia. Transportadora
// continua em dias úteis; a entrega própria (provider "local") fala em dias.
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

const localCom = (deliveryDays: number): ShippingOption => ({
  id: "local-delivery",
  name: "Entrega Local",
  price: 10,
  deliveryDays,
  provider: "local",
});
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
      freeShipping: false,
      createdAt: new Date(0).toISOString(),
    } as Product,
    quantity: 1,
  },
];

describe("ShippingCalculator e o prazo da entrega própria", () => {
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
          cepDestino="38500000"
          modoResumo={resumo}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  it("lista: prazo 2 da lojista aparece como 'até 2 dias', sem 'úteis'; a transportadora segue em dias úteis", async () => {
    await montar([localCom(2), PAC], PAC, false);
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Entrega em até 2 dias");
    expect(texto).not.toContain("2 dias úteis");
    // o único "dias úteis" que sobra é o da PAC, cotada de verdade
    expect(texto.match(/dias úteis/g)?.length).toBe(1);
    expect(texto).toContain("Entrega em até 3 dias úteis");
  });

  it("lista: prazo 1 vira 'até 1 dia' e prazo 0 segue 'no mesmo dia'", async () => {
    await montar([localCom(1)], localCom(1), false);
    expect(hospedeiro.textContent).toContain("Entrega em até 1 dia");
    expect(hospedeiro.textContent).not.toMatch(/dia útil|dias úteis/);

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar([localCom(0)], localCom(0), false);
    expect(hospedeiro.textContent).toContain("Entrega no mesmo dia");
    expect(hospedeiro.textContent).not.toMatch(/dia útil|dias úteis/);
  });

  it("resumo da opção escolhida: também sem 'úteis' na entrega própria", async () => {
    await montar([localCom(2)], localCom(2), true);
    expect(hospedeiro.textContent).toContain("Entrega em até 2 dias");
    expect(hospedeiro.textContent).not.toMatch(/dia útil|dias úteis/);
  });
});
