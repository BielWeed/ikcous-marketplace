// @vitest-environment jsdom
//
// O lembrete do carrinho (CartReminder) e o bloco da Home (FreeShippingBlock)
// comparavam o total do carrinho com a meta de frete grátis em ponto
// flutuante: 10.10 + 10.20 = 20.299999999999997 ficava "abaixo" de R$ 20,30
// e a tela dizia "Faltam R$ 0,00" em vez de "Liberado" (16/10/2026).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  config: {
    freeShippingMin: 20.3,
    freeShippingCardStyle: "completo",
    storeCity: "",
  } as Record<string, unknown>,
  cartTotal: 0,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));

vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: estado.cartTotal }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [{ product: { id: "p1" }, quantity: 1 }],
    getCartCount: () => 2,
    cartTotal: estado.cartTotal,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("meta de frete grátis em centavos — lembrete e bloco da Home", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    estado.config = {
      freeShippingMin: 20.3,
      freeShippingCardStyle: "completo",
      storeCity: "",
    };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  function texto(): string {
    return (document.body.textContent ?? "").replaceAll(
      String.fromCharCode(160),
      " ",
    );
  }

  async function montarLembrete(total: number) {
    estado.cartTotal = total;
    const { CartReminder } = await import(
      "@/components/ui/custom/CartReminder"
    );
    await act(async () => {
      raiz.render(<CartReminder onAction={() => {}} />);
    });
    // O lembrete aparece 1,5 s depois de montar.
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
  }

  async function montarBloco(total: number) {
    estado.cartTotal = total;
    const { FreeShippingBlock } = await import(
      "@/components/ui/custom/FreeShippingBlock"
    );
    await act(async () => {
      raiz.render(<FreeShippingBlock />);
    });
  }

  it("CartReminder: total 10.10 + 10.20, meta 20.30 -> 'Liberado', sem 'Faltam'", async () => {
    await montarLembrete(10.1 + 10.2);

    expect(texto()).toContain("Liberado");
    expect(texto()).not.toContain("Faltam");
  });

  it("CartReminder CONTROLE: um centavo abaixo (20.29) -> 'Faltam R$ 0,01'", async () => {
    await montarLembrete(20.29);

    expect(texto()).not.toContain("Liberado");
    expect(texto()).toContain("Faltam");
    expect(texto()).toContain("R$ 0,01");
  });

  it("FreeShippingBlock: total 10.10 + 10.20, meta 20.30 -> 'Liberado!'", async () => {
    await montarBloco(10.1 + 10.2);

    expect(texto()).toContain("Liberado!");
  });

  it("FreeShippingBlock compacto também libera na soma em centavos", async () => {
    estado.config.freeShippingCardStyle = "compacto";
    await montarBloco(10.1 + 10.2);
    expect(texto()).toContain("liberado");
    expect(texto()).not.toContain("Faltam");
  });

  it("FreeShippingBlock CONTROLE: um centavo abaixo (20.29) -> 'Falta pouquinho', nunca 'Liberado!'", async () => {
    await montarBloco(20.29);

    expect(texto()).not.toContain("Liberado!");
    expect(texto()).toContain("Falta pouquinho");
  });
});
