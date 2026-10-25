// @vitest-environment jsdom
// Vitrine (25/10), celular 390x844: o painel de sugestões da busca rola por
// dentro (altura máxima de 72% da tela) e o botão "Ver todos os resultados"
// ficava cortado ao meio na base. Ele agora é fixo (sticky) no fim do painel.
// jsdom NÃO calcula layout: aqui só se prova a classe aplicada; o visual em
// navegador real não é provado por este teste.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn() },
}));

// @ts-expect-error flag de teste interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchBar — botão 'Ver todos os resultados'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("o rodapé do painel é sticky na base, para nunca ficar cortado", async () => {
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");
    await act(async () => {
      raiz.render(<SearchBar value="bo" onChange={() => {}} />);
    });
    const campo = hospedeiro.querySelector("input")!;
    await act(async () => {
      campo.focus();
      campo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ver todos os resultados"),
    );
    expect(botao).toBeDefined();
    const rodape = botao!.parentElement!;
    expect(rodape.className).toContain("sticky");
    expect(rodape.className).toContain("bottom-0");
    expect(rodape.className).toContain("bg-white");
  }, 15000);
});
