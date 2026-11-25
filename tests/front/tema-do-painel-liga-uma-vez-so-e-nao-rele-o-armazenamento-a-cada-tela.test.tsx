// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), tema do painel. O gancho do AdminLayout liga o
// tema ao ENTRAR no painel e desliga ao sair. Se ele fosse refeito a cada
// desenho da tela, cada toque numa aba do painel leria o armazenamento de novo
// e desligaria/religaria o tema na <html> (o tempo todo, no aparelho mais fraco
// da lojista). Nenhum teste prendia "uma vez só".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_DO_TEMA_DO_PAINEL,
  useTemaDoPainelNaRaiz,
} from "@/components/admin/temaDoPainel";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos outros testes de componente.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const raizHtml = document.documentElement;

function Painel({ rotulo }: { rotulo: string }) {
  useTemaDoPainelNaRaiz();
  return <p>{rotulo}</p>;
}

let container: HTMLDivElement;
let root: Root;
const guardado = new Map<string, string>();
const getItem = vi.fn((chave: string) => guardado.get(chave) ?? null);

beforeEach(() => {
  guardado.clear();
  getItem.mockClear();
  vi.stubGlobal("localStorage", {
    getItem,
    setItem: (chave: string, valor: string) => guardado.set(chave, valor),
    removeItem: (chave: string) => guardado.delete(chave),
    clear: () => guardado.clear(),
    key: () => null,
    length: 0,
  });
  raizHtml.removeAttribute("data-admin-tema");
  raizHtml.classList.remove("admin-mode");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  guardado.clear();
});

describe("useTemaDoPainelNaRaiz: liga uma vez ao entrar", () => {
  it("redesenhar a tela várias vezes lê o tema guardado só uma vez", () => {
    guardado.set(CHAVE_DO_TEMA_DO_PAINEL, "claro");

    act(() => root.render(<Painel rotulo="a" />));
    act(() => root.render(<Painel rotulo="b" />));
    act(() => root.render(<Painel rotulo="c" />));

    const leiturasDoTema = getItem.mock.calls.filter(
      ([chave]) => chave === CHAVE_DO_TEMA_DO_PAINEL,
    );
    expect(leiturasDoTema).toHaveLength(1);
    expect(raizHtml.classList.contains("admin-mode")).toBe(true);
    expect(raizHtml.dataset.adminTema).toBe("claro");
  });

  it("o tema escolhido DEPOIS de entrar não é trocado por um redesenho da tela", () => {
    guardado.set(CHAVE_DO_TEMA_DO_PAINEL, "claro");
    act(() => root.render(<Painel rotulo="a" />));
    expect(raizHtml.dataset.adminTema).toBe("claro");

    // Alguém grava outro valor no armazenamento sem passar pelo seletor.
    guardado.set(CHAVE_DO_TEMA_DO_PAINEL, "confortavel");
    act(() => root.render(<Painel rotulo="b" />));

    expect(raizHtml.dataset.adminTema).toBe("claro");
  });

  it("ao sair do painel tira a classe e o tema da <html>", () => {
    guardado.set(CHAVE_DO_TEMA_DO_PAINEL, "confortavel");
    act(() => root.render(<Painel rotulo="a" />));
    expect(raizHtml.dataset.adminTema).toBe("confortavel");

    act(() => root.render(<p>vitrine</p>));

    expect(raizHtml.classList.contains("admin-mode")).toBe(false);
    expect(raizHtml.dataset.adminTema).toBeUndefined();
  });
});
