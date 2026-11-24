// Caça por mutação nos textos de tempo do painel. Os testes que já existem
// provam 119 s / 120 s e 59 min, mas deixavam passar três trocas de fronteira:
//   - `horarioRelativo` com exatamente 60 min: é "hoje HH:MM", não "há 60 min";
//   - `distanciaCurta` com exatamente 1 min: é "em 1m", não "em instantes";
//   - `distanciaCurta` com diferença ZERO: sem futuro, então "há instantes".
// Relógio fixo: nada aqui depende da hora da máquina.
import { horarioRelativo } from "@/lib/horario-relativo";
import { distanciaCurta } from "@/lib/tempo-relativo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 02/09/2026 15:00 em Brasília.
const AGORA = new Date("2026-09-02T18:00:00Z");
const MIN = 60_000;

describe("horarioRelativo — a fronteira de 1 hora", () => {
  it("59 min ainda é 'há 59 min'; com 60 min cravados já vira 'hoje' com a hora", () => {
    const haMin = (min: number) =>
      new Date(AGORA.getTime() - min * MIN).toISOString();

    expect(horarioRelativo(haMin(59), AGORA)).toBe("há 59 min");
    expect(horarioRelativo(haMin(60), AGORA)).toBe("hoje 14:00");
    expect(horarioRelativo(haMin(61), AGORA)).toBe("hoje 13:59");
  });

  it("59 min e 59,9 s ainda contam 59 (a conta corta os segundos)", () => {
    const iso = new Date(AGORA.getTime() - (60 * MIN - 1)).toISOString();
    expect(horarioRelativo(iso, AGORA)).toBe("há 59 min");
  });
});

describe("distanciaCurta — a fronteira de 1 minuto e o instante zero", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
  });
  afterEach(() => vi.useRealTimers());

  const em = (ms: number) => new Date(AGORA.getTime() + ms).toISOString();

  it("59,9 s ainda é 'instantes'; com 1 minuto cravado já mostra 'em 1m' / 'há 1m'", () => {
    expect(distanciaCurta(em(59_999))).toBe("em instantes");
    expect(distanciaCurta(em(MIN))).toBe("em 1m");
    expect(distanciaCurta(em(-59_999))).toBe("há instantes");
    expect(distanciaCurta(em(-MIN))).toBe("há 1m");
  });

  it("exatamente agora não é futuro: 'há instantes'", () => {
    expect(distanciaCurta(em(0))).toBe("há instantes");
  });

  it("1 h cravada mostra '1h 0m', sem virar minutos soltos", () => {
    expect(distanciaCurta(em(60 * MIN))).toBe("em 1h 0m");
    expect(distanciaCurta(em(-(60 * MIN)))).toBe("há 1h 0m");
    expect(distanciaCurta(em(59 * MIN))).toBe("em 59m");
  });
});
