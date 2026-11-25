// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), EmptyCart. A tela do carrinho vazio não tinha teste próprio
// (só aparecia como pano de fundo de outras telas):
//  - diz que o carrinho está vazio e convida a explorar a loja, com a frase inteira;
//  - o botão "Explorar Produtos" dá a vibração média do app e leva à vitrine (`home`), uma vez só.
import { EmptyCart } from "@/components/ui/custom/EmptyCart";
import { haptic } from "@/utils/haptic";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("EmptyCart: carrinho vazio", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    onNavigate.mockReset();
    vi.mocked(haptic.medium).mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    act(() => {
      raiz.render(<EmptyCart onNavigate={onNavigate} />);
    });
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
  });

  it("diz que o carrinho está vazio e convida a explorar as novidades", () => {
    expect(host.querySelector("h2")?.textContent).toBe(
      "Seu carrinho está vazio",
    );
    expect(host.querySelector("p")?.textContent).toBe(
      "Parece que você ainda não adicionou nenhum item ao seu carrinho. Que tal explorar nossas novidades?",
    );
  });

  it("o botão vibra uma vez e leva à vitrine, uma vez só", () => {
    const botao = host.querySelector("button");
    expect(botao?.textContent).toBe("Explorar Produtos");
    act(() => {
      botao?.click();
    });
    expect(haptic.medium).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("home");
  });
});
