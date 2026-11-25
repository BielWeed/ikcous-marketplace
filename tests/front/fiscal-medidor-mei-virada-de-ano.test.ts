// Medidor do MEI na virada de 2026 para 2027 (decisão do sócio, 25/11/2026, item 7).
//
// Os valores de 2027 (limite do MEI, DAS-MEI, Simples) NÃO existem ainda e não entram. Em
// janeiro, até alguém conferi-los, o medidor mostra "2026 fechado" com o limite de 2026 em
// vez de uma tela de "ano não conferido". Nunca se mostra um limite maior que o vigente, e
// não há aviso em dezembro: 31/12/2026 ainda é o medidor normal de 2026.
//
// O relógio entra de fora (`hoje`, o dia em São Paulo): nada aqui lê a hora do computador.
import { describe, expect, it } from "vitest";

import { qualAnoOMedidorMostra } from "@/lib/fiscal/medidor-mei";
import { parametrosDoAno } from "@/lib/fiscal/parametros-da-lei";

describe("qualAnoOMedidorMostra: o ano que o medidor do MEI mede, e se ele já fechou", () => {
  it("31/12/2026 ainda é o medidor NORMAL de 2026 (sem aviso em dezembro)", () => {
    expect(qualAnoOMedidorMostra("2026-12-31")).toEqual({
      ano: 2026,
      fechado: false,
    });
  });

  it("01/01/2027: '2026 fechado' (2027 não foi conferido)", () => {
    expect(qualAnoOMedidorMostra("2027-01-01")).toEqual({
      ano: 2026,
      fechado: true,
    });
  });

  it("31/01/2027: ainda '2026 fechado'", () => {
    expect(qualAnoOMedidorMostra("2027-01-31")).toEqual({
      ano: 2026,
      fechado: true,
    });
  });

  it("01/02/2027 sem os valores de 2027 conferidos: volta a medir 2027, e o núcleo recusa com o aviso de 'ano não conferido' (prazo duro de conferência)", () => {
    expect(qualAnoOMedidorMostra("2027-02-01")).toEqual({
      ano: 2027,
      fechado: false,
    });
  });

  it("o resto de 2026 e o meio de 2027 são o ano do próprio dia", () => {
    expect(qualAnoOMedidorMostra("2026-01-01")).toEqual({
      ano: 2026,
      fechado: false,
    });
    expect(qualAnoOMedidorMostra("2026-11-25")).toEqual({
      ano: 2026,
      fechado: false,
    });
    expect(qualAnoOMedidorMostra("2027-03-10")).toEqual({
      ano: 2027,
      fechado: false,
    });
  });

  it("depois que 2027 for conferido, janeiro de 2027 mede 2027 de verdade (sem '2026 fechado')", () => {
    const conferidos = new Set([2026, 2027]);
    expect(
      qualAnoOMedidorMostra("2027-01-15", (ano) => conferidos.has(ano)),
    ).toEqual({ ano: 2027, fechado: false });
  });

  it("nunca empresta um ano que NÃO foi conferido: em janeiro de 2028 (2027 também sem conferência) não há 'fechado' de 2027", () => {
    // 2027 não está conferido, então não há limite de 2027 para mostrar como "fechado":
    // o medidor mede 2028 e o núcleo recusa com o aviso.
    expect(qualAnoOMedidorMostra("2028-01-10")).toEqual({
      ano: 2028,
      fechado: false,
    });
  });

  it("o ano 'fechado' é sempre um ano que tem valores conferidos no código (nunca mostra um limite que não existe)", () => {
    const { ano, fechado } = qualAnoOMedidorMostra("2027-01-01");
    expect(fechado).toBe(true);
    expect(parametrosDoAno(ano).conferido).toBe(true);
  });

  it("MEI aberto em janeiro de 2027 (10/01) e hoje é 15/01/2027: NÃO é '2026 fechado' (a empresa não existia em 2026); mede 2027 e o núcleo mostra 'ano não conferido'", () => {
    expect(
      qualAnoOMedidorMostra("2027-01-15", undefined, "2027-01-10"),
    ).toEqual({ ano: 2027, fechado: false });
  });

  it("aberto no primeiro e no último dia de janeiro de 2027: também não é ano fechado", () => {
    expect(
      qualAnoOMedidorMostra("2027-01-31", undefined, "2027-01-01"),
    ).toEqual({ ano: 2027, fechado: false });
    expect(
      qualAnoOMedidorMostra("2027-01-31", undefined, "2027-01-31"),
    ).toEqual({ ano: 2027, fechado: false });
  });

  it("aberto em 31/12/2026 (último dia do ano fechado): a empresa existia em 2026, continua '2026 fechado'", () => {
    expect(
      qualAnoOMedidorMostra("2027-01-15", undefined, "2026-12-31"),
    ).toEqual({ ano: 2026, fechado: true });
  });

  it("aberto em ano anterior (2025, 2026 em janeiro, 2020): continua '2026 fechado'", () => {
    for (const abertaEm of ["2025-06-01", "2026-01-01", "2020-03-15"]) {
      expect(qualAnoOMedidorMostra("2027-01-15", undefined, abertaEm)).toEqual({
        ano: 2026,
        fechado: true,
      });
    }
  });

  it("sem data de abertura (null ou ausente): comportamento de antes, '2026 fechado'", () => {
    expect(qualAnoOMedidorMostra("2027-01-15", undefined, null)).toEqual({
      ano: 2026,
      fechado: true,
    });
    expect(qualAnoOMedidorMostra("2027-01-15")).toEqual({
      ano: 2026,
      fechado: true,
    });
  });

  it("aberto DEPOIS de 2027 (data futura): mede 2027, e é o núcleo que recusa; nunca '2026 fechado'", () => {
    expect(
      qualAnoOMedidorMostra("2027-01-15", undefined, "2028-03-01"),
    ).toEqual({ ano: 2027, fechado: false });
  });

  it("a data de abertura não muda dezembro, fevereiro nem o resto do ano", () => {
    expect(
      qualAnoOMedidorMostra("2026-12-31", undefined, "2026-12-01"),
    ).toEqual({ ano: 2026, fechado: false });
    expect(
      qualAnoOMedidorMostra("2027-02-01", undefined, "2027-01-10"),
    ).toEqual({ ano: 2027, fechado: false });
    expect(
      qualAnoOMedidorMostra("2027-02-01", undefined, "2025-01-10"),
    ).toEqual({ ano: 2027, fechado: false });
    expect(
      qualAnoOMedidorMostra("2027-03-10", undefined, "2027-01-10"),
    ).toEqual({ ano: 2027, fechado: false });
  });

  it("depois que 2027 for conferido, a abertura em 2027 mede 2027 de verdade", () => {
    const conferidos = new Set([2026, 2027]);
    expect(
      qualAnoOMedidorMostra(
        "2027-01-15",
        (ano) => conferidos.has(ano),
        "2027-01-10",
      ),
    ).toEqual({ ano: 2027, fechado: false });
  });

  it("data de abertura torta não decide nada: o núcleo é quem recusa (continua '2026 fechado' como antes)", () => {
    expect(
      qualAnoOMedidorMostra("2027-01-15", undefined, "2027-13-40"),
    ).toEqual({ ano: 2026, fechado: true });
    expect(qualAnoOMedidorMostra("2027-01-15", undefined, "")).toEqual({
      ano: 2026,
      fechado: true,
    });
  });

  it("data que não é uma data de verdade não inventa ano fechado: mede o ano que o texto traz, ou recusa", () => {
    expect(qualAnoOMedidorMostra("2027-13-01")).toEqual({
      ano: 2027,
      fechado: false,
    });
    // texto vazio ou torto nunca vira "2026 fechado"
    expect(qualAnoOMedidorMostra("").fechado).toBe(false);
    expect(qualAnoOMedidorMostra("janeiro").fechado).toBe(false);
  });
});
