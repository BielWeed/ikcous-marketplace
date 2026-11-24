// @vitest-environment jsdom
//
// `aoVoltarAAba`: as bordas que o teste vizinho (intervalo mínimo) não prende.
//  - com EXATOS 30 s desde a última leitura, refaz (29 999 ms não, 30 000 ms
//    sim);
//  - voltar à JANELA do navegador (evento `focus`, o caso do desktop) refaz,
//    e `focus` com a aba escondida não gasta rede nem a janela;
//  - a leitura é assíncrona e REJEITA: a rejeição é engolida (ninguém fica com
//    erro solto na página) — quem chama já trata a falha dentro da leitura;
//  - leitura que devolve nada (o comum, `undefined`) ou `null` não gera aviso
//    falso no console;
//  - leitura que LANÇA de forma síncrona vira aviso no console, não derruba o
//    ouvinte nem o próximo ciclo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aoVoltarAAba } from "@/lib/atualizar-ao-voltar-a-aba";

function visibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estado,
  });
}

function voltarAAba() {
  visibilidade("visible");
  document.dispatchEvent(new Event("visibilitychange"));
}

function voltarAJanela() {
  window.dispatchEvent(new Event("focus"));
}

describe("aoVoltarAAba — bordas de tempo, foco e leitura que falha", () => {
  let aviso: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    visibilidade("visible");
    aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    visibilidade("visible");
  });

  it("com 29 999 ms desde a montagem não refaz; com 30 000 ms refaz", () => {
    const acao = vi.fn();
    const soltar = aoVoltarAAba(acao);

    vi.advanceTimersByTime(29_999);
    voltarAAba();
    expect(acao).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    voltarAAba();
    expect(acao).toHaveBeenCalledTimes(1);
    soltar();
  });

  it("voltar à janela do navegador (focus) refaz depois do intervalo", () => {
    const acao = vi.fn();
    const soltar = aoVoltarAAba(acao);

    vi.advanceTimersByTime(30_000);
    voltarAJanela();

    expect(acao).toHaveBeenCalledTimes(1);
    soltar();
  });

  it("focus com a aba escondida não refaz e não gasta a janela", () => {
    const acao = vi.fn();
    const soltar = aoVoltarAAba(acao);

    vi.advanceTimersByTime(30_000);
    visibilidade("hidden");
    voltarAJanela();
    expect(acao).not.toHaveBeenCalled();

    // A janela não foi gasta: ao ficar visível, refaz na hora.
    voltarAAba();
    expect(acao).toHaveBeenCalledTimes(1);
    soltar();
  });

  it("a leitura rejeita: a rejeição é engolida (o ouvinte pendura um tratador na promessa)", () => {
    const tratar = vi.fn();
    // biome-ignore lint/suspicious/noThenProperty: precisa ser um thenable de verdade para provar que o ouvinte pendura o tratador
    const promessaQueRejeita = { then: tratar };
    const acao = vi.fn(() => promessaQueRejeita);
    const soltar = aoVoltarAAba(acao);

    vi.advanceTimersByTime(30_000);
    voltarAAba();

    expect(tratar).toHaveBeenCalledTimes(1);
    const [aoResolver, aoRejeitar] = tratar.mock.calls[0] as [
      unknown,
      (erro: unknown) => void,
    ];
    expect(aoResolver).toBeUndefined();
    expect(() => aoRejeitar(new Error("sem rede"))).not.toThrow();
    soltar();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["um número", 3],
  ])("a leitura devolve %s: nenhum aviso falso no console", (_, devolvido) => {
    const acao = vi.fn(() => devolvido);
    const soltar = aoVoltarAAba(acao);

    vi.advanceTimersByTime(30_000);
    voltarAAba();

    expect(acao).toHaveBeenCalledTimes(1);
    expect(aviso).not.toHaveBeenCalled();
    soltar();
  });

  it("a leitura lança de forma síncrona: vira aviso no console e o ciclo seguinte ainda refaz", () => {
    const erro = new Error("estourou");
    const acao = vi
      .fn<() => unknown>()
      .mockImplementationOnce(() => {
        throw erro;
      })
      .mockImplementation(() => undefined);
    const soltar = aoVoltarAAba(acao);

    vi.advanceTimersByTime(30_000);
    voltarAAba();

    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(
      "[aoVoltarAAba] a releitura lançou:",
      erro,
    );

    // A janela foi gasta pela tentativa que lançou; passado o intervalo, volta.
    vi.advanceTimersByTime(30_000);
    voltarAAba();
    expect(acao).toHaveBeenCalledTimes(2);
    soltar();
  });
});
