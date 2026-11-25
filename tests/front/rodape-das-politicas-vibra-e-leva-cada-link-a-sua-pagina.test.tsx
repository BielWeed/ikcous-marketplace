// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), RodapeDasPoliticas. Cada link do rodapé da vitrine:
//  - dá a vibração leve do app (uma vez por toque);
//  - leva à página da PRÓPRIA política (cada tipo vai para a sua tela, nunca para a vizinha);
//  - o último link, "Sobre a loja", leva a `about-store`.
import { RodapeDasPoliticas } from "@/components/politicas/RodapeDasPoliticas";
import {
  TIPOS_DE_POLITICA,
  nomeDaPolitica,
  viewDaPolitica,
} from "@/lib/nomes-das-politicas";
import { haptic } from "@/utils/haptic";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("RodapeDasPoliticas: cada link vibra e leva à sua página", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    onNavigate.mockReset();
    vi.mocked(haptic.light).mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    act(() => {
      raiz.render(<RodapeDasPoliticas onNavigate={onNavigate} />);
    });
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
  });

  const botao = (texto: string) =>
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent === texto,
    ) as HTMLButtonElement;

  it("os links aparecem na ordem dos tipos de política e depois 'Sobre a loja'", () => {
    expect(
      [...host.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual([
      ...TIPOS_DE_POLITICA.map((t) => nomeDaPolitica(t)),
      "Sobre a loja",
    ]);
  });

  it("cada política vibra uma vez e leva à sua própria página", () => {
    let toques = 0;
    for (const tipo of TIPOS_DE_POLITICA) {
      act(() => {
        botao(nomeDaPolitica(tipo)).click();
      });
      toques += 1;
      expect(haptic.light).toHaveBeenCalledTimes(toques);
      expect(onNavigate).toHaveBeenCalledTimes(toques);
      expect(onNavigate).toHaveBeenLastCalledWith(viewDaPolitica(tipo));
    }
    const destinos = onNavigate.mock.calls.map((c) => c[0]);
    expect(new Set(destinos).size).toBe(TIPOS_DE_POLITICA.length);
  });

  it("'Sobre a loja' vibra uma vez e leva a about-store", () => {
    act(() => {
      botao("Sobre a loja").click();
    });
    expect(haptic.light).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("about-store");
  });
});
