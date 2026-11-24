// @vitest-environment jsdom
//
// O lembrete do carrinho só fala de frete grátis quando existe uma meta de
// VALOR (ou o "sempre"). Na loja com o preset "por produto marcado" o
// `freeShippingMin` salvo é -1 (sentinela): sem número de corte, o lembrete só
// conta os itens. Se a guarda deixasse o -1 passar como meta, o total de
// qualquer carrinho "atingiria" -1 e o lembrete anunciaria "Frete Grátis
// Liberado" para quem comprou um produto que nem é o marcado (achado por
// mutação, 24/11/2026: nenhum teste vizinho usava o preset por produto).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRETE_GRATIS_POR_PRODUTO,
  FRETE_GRATIS_SEMPRE,
} from "@/lib/presets-de-frete-gratis";

const estado = vi.hoisted(() => ({
  config: {
    freeShippingMin: 0,
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
    cartCount: 2,
    cartTotal: estado.cartTotal,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CartReminder — o preset do lojista decide o que o lembrete promete", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
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

  async function montarLembrete(freeShippingMin: number, total: number) {
    estado.config = {
      freeShippingMin,
      freeShippingCardStyle: "completo",
      storeCity: "",
    };
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

  it("por produto marcado: só conta os itens, nunca 'Frete Grátis' nem 'Faltam'", async () => {
    await montarLembrete(FRETE_GRATIS_POR_PRODUTO, 50);

    expect(texto()).toContain("2 itens no seu carrinho");
    expect(texto()).not.toContain("Frete");
    expect(texto()).not.toContain("Faltam");
  });

  it("CONTROLE desligado (0): também só conta os itens", async () => {
    await montarLembrete(0, 50);

    expect(texto()).toContain("2 itens no seu carrinho");
    expect(texto()).not.toContain("Frete");
  });

  it("CONTROLE 'sempre' (0,01): promete frete grátis em toda a loja, sem número de corte", async () => {
    await montarLembrete(FRETE_GRATIS_SEMPRE, 50);

    expect(texto()).toContain("Frete grátis em toda a loja");
    expect(texto()).not.toContain("Faltam");
  });
});
