// Ordem dos avisos de status do mesmo pedido: o service worker olha o carimbo
// (`data.emitidoEm`) dos avisos que o pedido já tem na bandeja. Aviso SEM dados
// (campanha, teste do aparelho), com carimbo que não é número finito, ou em
// forma estranha NUNCA pode derrubar o service worker nem "ganhar" a ordem — e
// um carimbo infinito nunca vira o "mais novo" que esconde os avisos de verdade.
import { describe, expect, it } from "vitest";

import {
  CAMPO_DO_CARIMBO_DO_AVISO,
  avisoMaisNovoQue,
  carimboDoAviso,
} from "@/lib/ordem-do-aviso-do-pedido";

interface AvisoDaBandeja {
  readonly tag: string;
  readonly data?: unknown;
}

const aviso = (tag: string, data?: unknown): AvisoDaBandeja => ({ tag, data });

describe("carimboDoAviso", () => {
  it("o campo do carimbo se chama emitidoEm", () => {
    expect(CAMPO_DO_CARIMBO_DO_AVISO).toBe("emitidoEm");
  });

  it.each([
    ["sem dados", undefined],
    ["dados nulos", null],
    ["dados em texto", "emitidoEm"],
    ["dados em número", 1_700_000_000_000],
    ["dados em lista", [1_700_000_000_000]],
    ["objeto vazio", {}],
  ])("%s: não há carimbo (null, sem lançar erro)", (_nome, data) => {
    expect(carimboDoAviso(data)).toBeNull();
  });

  it.each([
    ["texto numérico", "1700000000000"],
    ["não é número (NaN)", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
    ["menos infinito", Number.NEGATIVE_INFINITY],
    ["nulo", null],
    ["verdadeiro", true],
  ])("carimbo %s não vale", (_nome, emitidoEm) => {
    expect(carimboDoAviso({ emitidoEm })).toBeNull();
  });

  it("número finito vale, inclusive zero", () => {
    expect(carimboDoAviso({ emitidoEm: 1_700_000_000_000 })).toBe(
      1_700_000_000_000,
    );
    expect(carimboDoAviso({ emitidoEm: 0 })).toBe(0);
  });
});

describe("avisoMaisNovoQue", () => {
  it("devolve o MAIS novo entre os que são mais novos que o que chegou", () => {
    const noventa = aviso("a", { emitidoEm: 150 });
    const maisNovo = aviso("b", { emitidoEm: 200 });
    const naoMaisNovo = aviso("c", { emitidoEm: 120 });

    expect(avisoMaisNovoQue(100, [noventa, maisNovo, naoMaisNovo])).toBe(
      maisNovo,
    );
    expect(avisoMaisNovoQue(100, [maisNovo, noventa, naoMaisNovo])).toBe(
      maisNovo,
    );
  });

  it("empate ou mais velho: nenhum é mais novo (mostra, como antes)", () => {
    expect(avisoMaisNovoQue(100, [aviso("a", { emitidoEm: 100 })])).toBeNull();
    expect(avisoMaisNovoQue(100, [aviso("a", { emitidoEm: 99 })])).toBeNull();
    expect(avisoMaisNovoQue(100, [])).toBeNull();
  });

  it("aviso sem dados ou com carimbo inválido na bandeja é ignorado, sem quebrar", () => {
    const bandeja = [
      aviso("sem-dados"),
      aviso("nulo", null),
      aviso("texto", "x"),
      aviso("lista", [200]),
      aviso("infinito", { emitidoEm: Number.POSITIVE_INFINITY }),
      aviso("nan", { emitidoEm: Number.NaN }),
      aviso("em-texto", { emitidoEm: "999" }),
    ];

    expect(avisoMaisNovoQue(100, bandeja)).toBeNull();
  });

  it("um aviso válido ao lado dos inválidos ainda é achado", () => {
    const valido = aviso("valido", { emitidoEm: 300 });

    expect(
      avisoMaisNovoQue(100, [
        aviso("sem-dados"),
        aviso("infinito", { emitidoEm: Number.POSITIVE_INFINITY }),
        valido,
      ]),
    ).toBe(valido);
  });
});
