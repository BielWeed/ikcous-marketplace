// Datas e tempos no painel e na loja:
//  (a) idade da devolução conta por DIA do calendário de São Paulo: pedida ontem
//      à noite não aparece como "hoje" na manhã seguinte;
//  (b) "há X" com relógio do celular atrasado: data no futuro nunca vira "em 3
//      minutos";
//  (c) tempo do banner: "expira em 1 dia" quando faltam quase 2 dias passa a
//      mostrar horas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { idadeEmDias, textoDaIdade } from "@/lib/devolucao";
import { distanciaCurta, tempoRelativo } from "@/lib/tempo-relativo";

const AGORA = new Date("2026-09-27T12:00:00Z"); // 09h de 27/09 em São Paulo
const HORA = 3_600_000;
const MIN = 60_000;

describe("idade da devolução — dia do calendário de São Paulo", () => {
  it("pedida às 22h de ontem e vista às 9h: 'há 1 dia' (11h corridas)", () => {
    expect(textoDaIdade("2026-09-27T01:00:00Z", AGORA)).toBe("há 1 dia");
    expect(idadeEmDias("2026-09-27T01:00:00Z", AGORA)).toBe(1);
  });

  it("47h corridas atrás, mas dois dias de calendário: 'há 2 dias'", () => {
    const iso = new Date(AGORA.getTime() - 47 * HORA).toISOString();
    expect(textoDaIdade(iso, AGORA)).toBe("há 2 dias");
  });

  it("a virada da meia-noite de São Paulo troca o rótulo (1 minuto de diferença)", () => {
    const iso = "2026-09-27T02:59:00Z"; // 23h59 de 26/09
    expect(textoDaIdade(iso, new Date("2026-09-27T02:59:30Z"))).toBe("hoje");
    expect(textoDaIdade(iso, new Date("2026-09-27T03:00:00Z"))).toBe(
      "há 1 dia",
    );
  });

  it("controle: pedida hoje cedo (00h05) e vista às 9h segue 'hoje'", () => {
    expect(textoDaIdade("2026-09-27T03:05:00Z", AGORA)).toBe("hoje");
  });

  it("cinco dias de calendário (e não 4 corridos)", () => {
    expect(textoDaIdade("2026-09-22T20:00:00Z", AGORA)).toBe("há 5 dias");
  });

  it("data no futuro (relógio atrasado) ou ilegível não quebra", () => {
    expect(textoDaIdade("2026-09-28T12:00:00Z", AGORA)).toBe("hoje");
    expect(idadeEmDias("lixo", AGORA)).toBeNull();
    expect(textoDaIdade("lixo", AGORA)).toBe("");
  });
});

describe("tempoRelativo — nunca no futuro", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
  });
  afterEach(() => vi.useRealTimers());

  it("relógio do celular atrasado 3 min: não diz 'em 3 minutos'", () => {
    const texto = tempoRelativo(new Date(AGORA.getTime() + 3 * MIN));
    expect(texto).not.toMatch(/^em /);
    expect(texto).toBe("há menos de um minuto");
  });

  it("controle: passado continua em português com 'há'", () => {
    expect(
      tempoRelativo(new Date(AGORA.getTime() - 3 * MIN).toISOString()),
    ).toBe("há 3 minutos");
    expect(
      tempoRelativo(new Date(AGORA.getTime() - 2 * HORA).toISOString()),
    ).toBe("há cerca de 2 horas");
  });

  it("data ilegível ou ausente vira texto vazio, sem lançar erro", () => {
    expect(tempoRelativo("lixo")).toBe("");
    expect(tempoRelativo(null)).toBe("");
    expect(tempoRelativo(undefined)).toBe("");
  });
});

describe("distanciaCurta — tempo do banner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
  });
  afterEach(() => vi.useRealTimers());

  const em = (ms: number) => new Date(AGORA.getTime() + ms).toISOString();

  it("faltam 47h: mostra horas, não 'em 1 dia'", () => {
    expect(distanciaCurta(em(47 * HORA))).toBe("em 47h 0m");
    expect(distanciaCurta(em(47 * HORA + 30 * MIN))).toBe("em 47h 30m");
  });

  it("faltam 48h ou mais: dias inteiros", () => {
    expect(distanciaCurta(em(48 * HORA))).toBe("em 2 dias");
    expect(distanciaCurta(em(3 * 24 * HORA + 5 * HORA))).toBe("em 3 dias");
  });

  it("faltam 30 segundos: 'em instantes', nunca 'em 0m'", () => {
    expect(distanciaCurta(em(30_000))).toBe("em instantes");
    expect(distanciaCurta(em(-30_000))).toBe("há instantes");
  });

  it("passado segue a mesma regra", () => {
    expect(distanciaCurta(em(-47 * HORA))).toBe("há 47h 0m");
    expect(distanciaCurta(em(-48 * HORA))).toBe("há 2 dias");
  });

  it("controle: horas e minutos curtos continuam iguais", () => {
    expect(distanciaCurta(em(5 * HORA + 30 * MIN))).toBe("em 5h 30m");
    expect(distanciaCurta(em(10 * MIN))).toBe("em 10m");
    expect(distanciaCurta(em(-10 * MIN))).toBe("há 10m");
  });

  it("ausente ou ilegível vira texto vazio", () => {
    expect(distanciaCurta(null)).toBe("");
    expect(distanciaCurta("lixo")).toBe("");
  });
});
