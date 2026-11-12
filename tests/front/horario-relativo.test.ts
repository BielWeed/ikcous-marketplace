import { horarioRelativo } from "@/lib/horario-relativo";
import { describe, expect, it } from "vitest";

// Âncora fixa: 02/09/2026 15:00 em Brasília, independente do fuso do aparelho.
const AGORA = new Date("2026-09-02T18:00:00Z");
const haMinutos = (min: number) =>
  new Date(AGORA.getTime() - min * 60000).toISOString();

describe("horarioRelativo", () => {
  it("menos de 2 min é agora mesmo, inclusive data no futuro", () => {
    expect(horarioRelativo(haMinutos(0), AGORA)).toBe("agora mesmo");
    expect(horarioRelativo(haMinutos(1), AGORA)).toBe("agora mesmo");
    expect(horarioRelativo(haMinutos(-5), AGORA)).toBe("agora mesmo");
  });

  it("menos de 1 hora usa há N min", () => {
    expect(horarioRelativo(haMinutos(5), AGORA)).toBe("há 5 min");
    expect(horarioRelativo(haMinutos(59), AGORA)).toBe("há 59 min");
  });

  it("hoje mostra a hora de Brasília", () => {
    expect(horarioRelativo("2026-09-02T11:05:00Z", AGORA)).toBe("hoje 08:05");
  });

  it("ontem mostra ontem e a hora de Brasília", () => {
    expect(horarioRelativo("2026-09-02T02:10:00Z", AGORA)).toBe("ontem 23:10");
  });

  it('"ontem" cruzando o mês (agora 01/09, pedido 31/08)', () => {
    expect(
      horarioRelativo("2026-09-01T01:15:00Z", new Date("2026-09-01T03:30:00Z")),
    ).toBe("ontem 22:15");
  });

  it("o dia de Brasília prevalece sobre o dia UTC", () => {
    expect(
      horarioRelativo("2026-10-15T02:30:00Z", new Date("2026-10-15T14:00:00Z")),
    ).toBe("ontem 23:30");
    expect(
      horarioRelativo("2026-10-15T02:30:00Z", new Date("2026-10-17T14:00:00Z")),
    ).toBe("14/10");
  });

  it("antigo no mesmo ano mostra DD/MM", () => {
    expect(horarioRelativo("2026-08-16T13:00:00Z", AGORA)).toBe("16/08");
  });

  it("antigo em outro ano acrescenta o ano", () => {
    expect(horarioRelativo("2024-08-16T13:00:00Z", AGORA)).toBe("16/08/24");
  });

  it("a virada do ano também segue o calendário de Brasília", () => {
    expect(
      horarioRelativo("2026-01-01T02:30:00Z", new Date("2026-01-03T14:00:00Z")),
    ).toBe("31/12/25");
    expect(
      horarioRelativo("2025-01-01T15:00:00Z", new Date("2026-01-01T02:30:00Z")),
    ).toBe("01/01");
    expect(
      horarioRelativo("2026-01-01T02:30:00Z", new Date("2026-01-01T14:00:00Z")),
    ).toBe("ontem 23:30");
  });

  it("data inválida devolve vazio", () => {
    expect(horarioRelativo("não é data", AGORA)).toBe("");
  });
});
