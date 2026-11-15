import { triggerFlyingCartAnimation } from "@/utils/cartAnimation";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("o voo do carrinho termina no botão visível", () => {
  for (const [computador, alvo] of [
    [false, "bottom-nav-cart"],
    [true, "header-cart"],
  ] as const) {
    it(computador
      ? "PC mira o cabeçalho, não a pílula escondida"
      : "celular preserva o alvo inferior", () => {
      vi.useFakeTimers();
      vi.stubGlobal("matchMedia", () => ({ matches: computador }));
      const origem = document.createElement("div");
      const topo = document.createElement("button");
      topo.id = "header-cart";
      const baixo = document.createElement("button");
      baixo.id = "bottom-nav-cart";
      document.body.append(origem, topo, baixo);
      triggerFlyingCartAnimation(origem, "");
      vi.advanceTimersByTime(760);
      expect(document.querySelector(".cart-pop")?.id).toBe(alvo);
    });
  }
});
