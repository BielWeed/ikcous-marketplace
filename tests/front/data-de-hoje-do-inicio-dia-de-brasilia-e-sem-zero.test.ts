// @vitest-environment jsdom
import { dataPorExtenso } from "@/components/admin/inicio/DataDeHoje";
import { describe, expect, it } from "vitest";

// Caça por mutação em `dataPorExtenso` (a data sob o título do Início).
// O teste vizinho (`inicio-data-e-hoje-acompanham-o-relogio.test.tsx`) prova o
// texto da tela com a hora do meio do dia, e deixava passar duas trocas:
//   - o fuso do formatador virar UTC: à noite de Brasília (a partir das 21h, já
//     "amanhã" em UTC) o Início mostrava o dia seguinte e a semana errada;
//   - o dia sair com zero à esquerda ("05 de novembro" em vez de "5 de novembro").
// Instantes literais em UTC (Brasília = UTC-3); independem do fuso da máquina.

describe("dataPorExtenso — o dia e a semana são os de Brasília", () => {
  it("às 22h07 de terça (já quarta em UTC), ainda é terça", () => {
    // 25/11/2026 01:07 UTC = terça, 24/11, 22:07 em Brasília.
    expect(dataPorExtenso(new Date("2026-11-25T01:07:00.000Z"))).toBe(
      "Terça, 24 de novembro",
    );
  });

  it("logo depois da meia-noite de Brasília já é o dia novo", () => {
    // 25/11/2026 03:00 UTC = quarta, 25/11, 00:00 em Brasília.
    expect(dataPorExtenso(new Date("2026-11-25T03:00:00.000Z"))).toBe(
      "Quarta, 25 de novembro",
    );
  });

  it("dia de um dígito não leva zero à esquerda", () => {
    // 05/11/2026 15:00 UTC = quinta, 5/11, 12:00 em Brasília.
    expect(dataPorExtenso(new Date("2026-11-05T15:00:00.000Z"))).toBe(
      "Quinta, 5 de novembro",
    );
  });
});
