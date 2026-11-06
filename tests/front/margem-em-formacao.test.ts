// Margem "em formação": no começo do mês as despesas do mês INTEIRO já estão
// lançadas e a receita só vai até hoje, então o percentual de lucro sai
// absurdo (−1.566,7%). Regra única, a mesma do Início e do Resultado.
import { describe, expect, it } from "vitest";

import {
  ULTIMO_DIA_DA_MARGEM_EM_FORMACAO,
  margemEmFormacao,
} from "@/lib/margem-em-formacao";

const NOVEMBRO = { inicio: "2026-11-01", fim: "2026-11-30" };

describe("margemEmFormacao", () => {
  it("o último dia da formação é o 15 (o mesmo que o Início já usava)", () => {
    expect(ULTIMO_DIA_DA_MARGEM_EM_FORMACAO).toBe(15);
  });

  it("mês corrente, percentual negativo, até o dia 15: em formação", () => {
    expect(margemEmFormacao(-1566.7, "2026-11-03", NOVEMBRO)).toBe(true);
    expect(margemEmFormacao(-1566.7, "2026-11-15", NOVEMBRO)).toBe(true);
    expect(margemEmFormacao(-0.1, "2026-11-01", NOVEMBRO)).toBe(true);
  });

  it("do dia 16 em diante o percentual vale", () => {
    expect(margemEmFormacao(-1566.7, "2026-11-16", NOVEMBRO)).toBe(false);
    expect(margemEmFormacao(-1566.7, "2026-11-30", NOVEMBRO)).toBe(false);
  });

  it("percentual zero, positivo ou sem base nunca está em formação", () => {
    expect(margemEmFormacao(0, "2026-11-03", NOVEMBRO)).toBe(false);
    expect(margemEmFormacao(19, "2026-11-03", NOVEMBRO)).toBe(false);
    expect(margemEmFormacao(null, "2026-11-03", NOVEMBRO)).toBe(false);
    expect(margemEmFormacao(Number.NaN, "2026-11-03", NOVEMBRO)).toBe(false);
    expect(
      margemEmFormacao(Number.NEGATIVE_INFINITY, "2026-11-03", NOVEMBRO),
    ).toBe(false);
  });

  it("período que não toca o mês corrente não está em formação", () => {
    const outubro = { inicio: "2026-10-01", fim: "2026-10-31" };
    expect(margemEmFormacao(-1566.7, "2026-11-03", outubro)).toBe(false);
    const dezembro = { inicio: "2026-12-01", fim: "2026-12-31" };
    expect(margemEmFormacao(-1566.7, "2026-11-03", dezembro)).toBe(false);
    // Mesmo mês, mas de outro ano.
    const novembroDoAnoPassado = { inicio: "2025-11-01", fim: "2025-11-30" };
    expect(margemEmFormacao(-1566.7, "2026-11-03", novembroDoAnoPassado)).toBe(
      false,
    );
  });

  it("período de vários meses NÃO esconde a margem: o prejuízo dos meses fechados é real", () => {
    // 01/09 a 05/11 (ex.: personalizado) e "Este ano" (01/01 a 31/12).
    expect(
      margemEmFormacao(-50, "2026-11-03", {
        inicio: "2026-09-01",
        fim: "2026-11-05",
      }),
    ).toBe(false);
    expect(
      margemEmFormacao(-5, "2026-11-03", {
        inicio: "2026-01-01",
        fim: "2026-12-31",
      }),
    ).toBe(false);
  });

  it("período dentro do mês corrente (ex.: 7 dias) conta", () => {
    expect(
      margemEmFormacao(-80, "2026-11-05", {
        inicio: "2026-11-01",
        fim: "2026-11-05",
      }),
    ).toBe(true);
  });

  it("sem período, não decide por conta própria", () => {
    expect(margemEmFormacao(-1566.7, "2026-11-03", null)).toBe(false);
  });

  it("vira o mês: dia 1 de dezembro olha dezembro, não novembro", () => {
    expect(margemEmFormacao(-80, "2026-12-01", NOVEMBRO)).toBe(false);
  });
});
