// @vitest-environment jsdom
//
// `aoVoltarAAba` (src/lib/atualizar-ao-voltar-a-aba.ts): o refetch por volta à
// aba que ocupa o lugar do tempo real do visitante sem login. O que importa:
// não martelar o banco (intervalo mínimo), não rodar com a aba escondida e
// soltar os ouvintes ao desmontar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INTERVALO_MINIMO_AO_VOLTAR_MS,
  aoVoltarAAba,
} from "@/lib/atualizar-ao-voltar-a-aba";

function visibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("aoVoltarAAba", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibilidade("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("o intervalo padrão é de 30 s", () => {
    expect(INTERVALO_MINIMO_AO_VOLTAR_MS).toBe(30_000);
  });

  it("não refaz antes do intervalo mínimo contado da montagem", () => {
    const acao = vi.fn();
    const soltar = aoVoltarAAba(acao);
    vi.advanceTimersByTime(29_000);
    visibilidade("visible");
    expect(acao).not.toHaveBeenCalled();
    soltar();
  });

  it("refaz depois do intervalo e só uma vez por janela", () => {
    const acao = vi.fn();
    const soltar = aoVoltarAAba(acao);
    vi.advanceTimersByTime(31_000);
    visibilidade("visible");
    expect(acao).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    visibilidade("visible");
    expect(acao).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(26_000);
    visibilidade("visible");
    expect(acao).toHaveBeenCalledTimes(2);
    soltar();
  });

  it("`focus` e `visibilitychange` juntos na mesma volta custam uma refeita", () => {
    const acao = vi.fn();
    const soltar = aoVoltarAAba(acao);
    vi.advanceTimersByTime(31_000);
    visibilidade("visible");
    window.dispatchEvent(new Event("focus"));
    expect(acao).toHaveBeenCalledTimes(1);
    soltar();
  });

  it("aba escondida não refaz, e não gasta a janela", () => {
    const acao = vi.fn();
    const soltar = aoVoltarAAba(acao);
    vi.advanceTimersByTime(60_000);
    visibilidade("hidden");
    expect(acao).not.toHaveBeenCalled();
    visibilidade("visible");
    expect(acao).toHaveBeenCalledTimes(1);
    soltar();
  });

  it("depois de soltar, nada mais dispara", () => {
    const acao = vi.fn();
    const soltar = aoVoltarAAba(acao);
    soltar();
    vi.advanceTimersByTime(60_000);
    visibilidade("visible");
    window.dispatchEvent(new Event("focus"));
    expect(acao).not.toHaveBeenCalled();
  });

  it("uma refeita que lança não derruba o ouvinte nem o evento da página", () => {
    const acao = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("rede caiu");
      })
      .mockImplementation(() => {});
    const soltar = aoVoltarAAba(acao);
    vi.advanceTimersByTime(31_000);
    expect(() => visibilidade("visible")).not.toThrow();
    vi.advanceTimersByTime(31_000);
    visibilidade("visible");
    expect(acao).toHaveBeenCalledTimes(2);
    soltar();
  });
});
