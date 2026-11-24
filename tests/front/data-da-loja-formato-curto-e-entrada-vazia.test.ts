import { formatarDataHoraBrasilia } from "@/lib/data-da-loja";
import { describe, expect, it } from "vitest";

// Caça por mutação em `formatarDataHoraBrasilia`. Os testes vizinhos provam o
// formato completo e o dia da compra, mas deixavam passar quatro coisas:
//   - tirar a guarda de entrada vazia: `null` virava `new Date(null)` = 1970 e a
//     tela mostrava "31/12/1969 21:00" em vez de nada;
//   - tirar a guarda de data ilegível: saía o texto "Invalid Date" na tela;
//   - o formato CURTO ("24/11 às 22:07") sem teste algum: fuso da hora trocado
//     para UTC (22:07 virava 01:07 do dia seguinte), dia sem zero à esquerda
//     ("5/03") e o conector "às" trocado.
// Instantes literais em UTC (Brasília = UTC-3), independentes do fuso da
// máquina. O formato completo só é conferido pelos números (o separador entre
// data e hora varia de uma versão do ICU para outra).

describe("formatarDataHoraBrasilia — sem data não inventa data", () => {
  it("nulo, indefinido e vazio devolvem texto vazio (nunca 1970)", () => {
    expect(formatarDataHoraBrasilia(null)).toBe("");
    expect(formatarDataHoraBrasilia(undefined)).toBe("");
    expect(formatarDataHoraBrasilia("")).toBe("");
    expect(formatarDataHoraBrasilia(null, "curto")).toBe("");
  });

  it("texto que não é data devolve vazio, não 'Invalid Date'", () => {
    expect(formatarDataHoraBrasilia("lixo")).toBe("");
    expect(formatarDataHoraBrasilia("lixo", "curto")).toBe("");
  });
});

describe("formatarDataHoraBrasilia — formato curto no relógio da loja", () => {
  it("noite de Brasília (já dia seguinte em UTC) mostra o dia e a hora da loja", () => {
    // 25/11 01:07 UTC = 24/11 22:07 em Brasília.
    expect(formatarDataHoraBrasilia("2026-11-25T01:07:00.000Z", "curto")).toBe(
      "24/11 às 22:07",
    );
  });

  it("dia e mês de um dígito levam zero à esquerda", () => {
    // 05/03 14:09 em Brasília.
    expect(formatarDataHoraBrasilia("2026-03-05T17:09:00.000Z", "curto")).toBe(
      "05/03 às 14:09",
    );
  });

  it("meia-noite de Brasília é 00:00", () => {
    expect(formatarDataHoraBrasilia("2026-11-24T03:00:00.000Z", "curto")).toBe(
      "24/11 às 00:00",
    );
  });
});

describe("formatarDataHoraBrasilia — formato completo no relógio da loja", () => {
  it("traz dia, mês, ano e hora de Brasília", () => {
    const texto = formatarDataHoraBrasilia("2026-11-25T01:07:00.000Z");
    expect(texto).toMatch(/^24\/11\/2026\D+22:07$/);
  });
});
