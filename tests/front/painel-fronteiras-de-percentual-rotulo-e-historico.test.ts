// Fronteiras dos utilitários puros por trás do Início, do gráfico do histórico
// e do cartão de margem — ramos que nenhum teste segurava (achados por mutação
// em 24/11/2026):
//  - margem sobre receita líquida de menos de meio centavo é "sem base", não
//    um percentual de milhares de por cento;
//  - percentual infinito ou ausente sai "—", nunca "∞%";
//  - rótulo de data incompleta volta como veio (não "undefined/11");
//  - a série "cobre mais de um ano" mesmo que chegue na ordem inversa;
//  - o aparo do início do histórico trata receita ou pedido negativos como
//    movimento (só o zero é "dia vazio").
import {
  rotuloDoDia,
  serieCobreMaisDeUmAno,
} from "@/components/admin/dashboard/rotulo-do-dia";
import { formatarPercentual, percentualDaReceita } from "@/lib/financeiro";
import { desdeOPrimeiroDiaDeMovimento } from "@/utils/desde-o-primeiro-dia-de-movimento";
import { describe, expect, it } from "vitest";

describe("percentualDaReceita: base que não chega a um centavo", () => {
  it("receita líquida de R$ 0,004 (arredonda a zero centavo) não tem margem", () => {
    expect(percentualDaReceita(1, 0.004)).toBeNull();
    expect(percentualDaReceita(1, 0)).toBeNull();
    expect(percentualDaReceita(1, -50)).toBeNull();
  });

  it("a partir de R$ 0,01 a conta vale", () => {
    expect(percentualDaReceita(1, 0.01)).toBeCloseTo(10_000, 5);
    expect(percentualDaReceita(50, 200)).toBe(25);
  });
});

describe("formatarPercentual (financeiro): infinito e ausente", () => {
  it("infinito, NaN e null saem '—'", () => {
    expect(formatarPercentual(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatarPercentual(Number.NEGATIVE_INFINITY)).toBe("—");
    expect(formatarPercentual(Number.NaN)).toBe("—");
    expect(formatarPercentual(null)).toBe("—");
  });

  it("zero medido sai '0,0%' (sem sinal)", () => {
    expect(formatarPercentual(0)).toBe("0,0%");
  });
});

describe("rótulos do eixo do histórico", () => {
  it("data incompleta volta como veio", () => {
    expect(rotuloDoDia("2026-11", false)).toBe("2026-11");
    expect(rotuloDoDia("2026", true)).toBe("2026");
  });

  it("data completa: dia/mês, com o ano de 2 dígitos quando a série cobre mais de um ano", () => {
    expect(rotuloDoDia("2026-11-24", false)).toBe("24/11");
    expect(rotuloDoDia("2026-11-24", true)).toBe("24/11/26");
  });

  it("a série cobre mais de um ano em qualquer ordem, e um ano só não cobre", () => {
    expect(
      serieCobreMaisDeUmAno([{ date: "2025-12-31" }, { date: "2026-01-02" }]),
    ).toBe(true);
    expect(
      serieCobreMaisDeUmAno([{ date: "2026-01-02" }, { date: "2025-12-31" }]),
    ).toBe(true);
    expect(
      serieCobreMaisDeUmAno([{ date: "2026-01-02" }, { date: "2026-12-31" }]),
    ).toBe(false);
  });
});

describe("desdeOPrimeiroDiaDeMovimento: só o zero é dia vazio", () => {
  it("receita negativa (dia de estorno) abre a série", () => {
    const historico = [
      { revenue: 0, orders: 0 },
      { revenue: -30, orders: 0 },
      { revenue: 10, orders: 1 },
    ];
    expect(desdeOPrimeiroDiaDeMovimento(historico)).toHaveLength(2);
  });

  it("contagem de pedidos negativa também abre a série", () => {
    const historico = [
      { revenue: 0, orders: 0 },
      { revenue: 0, orders: -1 },
      { revenue: 10, orders: 1 },
    ];
    expect(desdeOPrimeiroDiaDeMovimento(historico)).toHaveLength(2);
  });
});
