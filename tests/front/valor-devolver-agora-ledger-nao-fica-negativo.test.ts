// Protege o piso de zero após descontar o ledger, inclusive retratos desencontrados.
import { describe, expect, it } from "vitest";

import { valorDevolverAgoraDescontandoLedger } from "@/lib/valor-devolver-agora";

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
