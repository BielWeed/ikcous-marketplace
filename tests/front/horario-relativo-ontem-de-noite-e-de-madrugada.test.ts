import { horarioRelativo } from "@/lib/horario-relativo";
import { describe, expect, it } from "vitest";

// Caça por mutação em `horarioRelativo`: o "ontem" é o dia de Brasília de
// (agora - 24 h). Trocar as 24 h por 23 h deixava toda a suíte verde, porque
// os testes vizinhos só olham "agora" no começo da noite ou da tarde. Com 23 h,
// quando o painel é aberto a partir das 23h de Brasília o "dia de ontem" vira o
// PRÓPRIO dia de hoje, e o pedido da véspera aparece como "01/09" em vez de
// "ontem 10:00". Instantes literais em UTC (Brasília = UTC-3): independe do
// fuso da máquina.

// 10:00 de 01/09/2026 em Brasília.
const PEDIDO_DA_VESPERA = "2026-09-01T13:00:00.000Z";

describe("horarioRelativo — 'ontem' nas pontas do dia de Brasília", () => {
  it("às 23h30 de 02/09, o pedido das 10h de 01/09 ainda é 'ontem 10:00'", () => {
    const agora = new Date("2026-09-03T02:30:00.000Z");
    expect(horarioRelativo(PEDIDO_DA_VESPERA, agora)).toBe("ontem 10:00");
  });

  it("às 23h00 em ponto de 02/09, o pedido da véspera ainda é 'ontem'", () => {
    const agora = new Date("2026-09-03T02:00:00.000Z");
    expect(horarioRelativo(PEDIDO_DA_VESPERA, agora)).toBe("ontem 10:00");
  });

  it("às 00h30 de 02/09, o pedido das 10h de 01/09 é 'ontem 10:00'", () => {
    const agora = new Date("2026-09-02T03:30:00.000Z");
    expect(horarioRelativo(PEDIDO_DA_VESPERA, agora)).toBe("ontem 10:00");
  });

  it("às 23h30 de 02/09, o pedido de anteontem já mostra só a data", () => {
    const agora = new Date("2026-09-03T02:30:00.000Z");
    expect(horarioRelativo("2026-08-31T13:00:00.000Z", agora)).toBe("31/08");
  });
});
