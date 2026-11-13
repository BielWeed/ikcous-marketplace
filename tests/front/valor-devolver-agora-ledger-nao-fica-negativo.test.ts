// Protege o piso de zero após descontar o ledger, inclusive retratos desencontrados.
import { describe, expect, it } from "vitest";

import {
  valorDevolverAgora,
  valorDevolverAgoraDescontandoLedger,
} from "@/lib/valor-devolver-agora";

describe("valor a devolver — ledger nunca deixa saldo negativo", () => {
  it.each([
    { concluido: 40, emCurso: 70, esperado: 0, caso: "supera o total" },
    { concluido: 40, emCurso: 60, esperado: 0, caso: "zera exatamente" },
    { concluido: 40, emCurso: 25, esperado: 35, caso: "ainda deixa saldo" },
  ])(
    "$caso: concluído R$ $concluido e em curso R$ $emCurso",
    ({ concluido, emCurso, esperado }) => {
      const valor = valorDevolverAgoraDescontandoLedger(
        { total: 100, valorEstornado: 0, valorDevolvidoPorDevolucao: 0 },
        { concluido, emCurso },
      );

      expect(valor).toBe(esperado);
    },
  );
});

describe("valor a devolver agora — centavos exatos", () => {
  it("R$ 10 menos R$ 1,15 estornados são R$ 8,85 (1.15*100 dá 114.99…, e o arredondamento tem de subir)", () => {
    expect(valorDevolverAgora({ total: 10, valorEstornado: 1.15 })).toBe(8.85);
  });
});
