// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), FraseDeAceite e LinkDeTrocas. A folha de leitura é trocada por
// um dublê leve (ela é pesada e já é provada em politicas-folha-e-links); aqui vale só o que a
// frase decide:
//  - a frase diz a ação da cliente e termina com os dois links, na ordem "Termos de uso" e
//    "Política de Privacidade";
//  - cada link vibra uma vez e abre A SUA política (um nunca abre o do vizinho);
//  - fechar a folha desfaz a escolha; "Trocas e devoluções" vibra e abre `trocas`.
import {
  FraseDeAceite,
  LinkDeTrocas,
} from "@/components/politicas/LinksDasPoliticas";
import { nomeDaPolitica } from "@/lib/nomes-das-politicas";
import { haptic } from "@/utils/haptic";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn() },
}));
vi.mock("@/components/politicas/PoliticaEmFolhaSobDemanda", () => ({
  PoliticaEmFolhaSobDemanda: ({
    tipo,
    onFechar,
  }: { tipo: string | null; onFechar: () => void }) =>
    tipo ? (
      <div data-testid="folha-aberta" data-tipo={tipo}>
        <button type="button" onClick={onFechar}>
          fechar a folha
        </button>
      </div>
    ) : null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("FraseDeAceite e LinkDeTrocas", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.mocked(haptic.light).mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
  });

  const folha = () =>
    host.querySelector<HTMLElement>('[data-testid="folha-aberta"]');
  const botao = (texto: string) =>
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent === texto,
    ) as HTMLButtonElement;

  it("a frase diz a ação e termina com os dois links, na ordem", () => {
    act(() => {
      raiz.render(<FraseDeAceite acao="finalizar" />);
    });
    expect(
      host.querySelector('[data-testid="frase-de-aceite"]')?.textContent,
    ).toBe(
      `Ao finalizar você concorda com os ${nomeDaPolitica("termos")} e a ${nomeDaPolitica("privacidade")}.`,
    );
    act(() => {
      raiz.render(<FraseDeAceite acao="criar sua conta" />);
    });
    expect(
      host
        .querySelector('[data-testid="frase-de-aceite"]')
        ?.textContent?.startsWith("Ao criar sua conta você concorda"),
    ).toBe(true);
    expect(folha()).toBeNull();
  });

  it("cada link vibra uma vez e abre a política dele; fechar desfaz", () => {
    act(() => {
      raiz.render(<FraseDeAceite acao="finalizar" />);
    });
    act(() => {
      botao(nomeDaPolitica("termos")).click();
    });
    expect(haptic.light).toHaveBeenCalledTimes(1);
    expect(folha()?.dataset.tipo).toBe("termos");

    act(() => {
      botao("fechar a folha").click();
    });
    expect(folha()).toBeNull();

    act(() => {
      botao(nomeDaPolitica("privacidade")).click();
    });
    expect(haptic.light).toHaveBeenCalledTimes(2);
    expect(folha()?.dataset.tipo).toBe("privacidade");
    act(() => {
      botao("fechar a folha").click();
    });
    expect(folha()).toBeNull();
  });

  it("'Trocas e devoluções' vibra, abre `trocas` e fecha", () => {
    act(() => {
      raiz.render(<LinkDeTrocas />);
    });
    expect(folha()).toBeNull();
    act(() => {
      botao(nomeDaPolitica("trocas")).click();
    });
    expect(haptic.light).toHaveBeenCalledTimes(1);
    expect(folha()?.dataset.tipo).toBe("trocas");
    act(() => {
      botao("fechar a folha").click();
    });
    expect(folha()).toBeNull();
  });
});
