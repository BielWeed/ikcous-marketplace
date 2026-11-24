import { horarioRelativo } from "@/lib/horario-relativo";
import { describe, expect, it } from "vitest";

// Âncora fixa: 02/09/2026 15:00 em Brasília, independente do fuso do aparelho.
// O teste do vizinho (`horario-relativo.test.ts`) cobre 59 min e 2 min, mas
// nunca a hora CHEIA: trocar `< 60` por `<= 60` deixava a suíte verde e o
// pedido de exatamente 1 hora atrás continuava dizendo "há 60 min".
const AGORA = new Date("2026-09-02T18:00:00Z");
const haMs = (ms: number) => new Date(AGORA.getTime() - ms).toISOString();

describe("horarioRelativo — a virada de 'há N min' para a hora do dia", () => {
  it("59 min e 59 s ainda é 'há 59 min' (minuto cheio para baixo)", () => {
    expect(horarioRelativo(haMs(59 * 60_000 + 59_000), AGORA)).toBe(
      "há 59 min",
    );
  });

  it("exatamente 1 hora atrás já mostra a hora do dia, nunca 'há 60 min'", () => {
    expect(horarioRelativo(haMs(60 * 60_000), AGORA)).toBe("hoje 14:00");
  });

  it("1 hora e 1 minuto atrás também mostra a hora do dia", () => {
    expect(horarioRelativo(haMs(61 * 60_000), AGORA)).toBe("hoje 13:59");
  });

  it("1 hora atrás cruzando a meia-noite de Brasília vira 'ontem'", () => {
    // Agora = 00:30 de 02/09 em Brasília; uma hora antes = 23:30 de 01/09.
    const meiaNoite = new Date("2026-09-02T03:30:00Z");
    expect(horarioRelativo("2026-09-02T02:30:00Z", meiaNoite)).toBe(
      "ontem 23:30",
    );
  });
});
