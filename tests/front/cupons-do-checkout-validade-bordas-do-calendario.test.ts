import { validadeDoCupom } from "@/lib/cupons-do-checkout";
import { describe, expect, it } from "vitest";

// Caça por mutação em `validadeDoCupom` (texto do cartão de cupom no checkout).
// Os testes vizinhos (`cupons-do-checkout-lib.test.ts`) provam "hoje", "amanhã"
// e "Válido até" só com datas que NÃO se parecem com hoje. Cinco trocas
// deixavam a suíte verde e mostravam texto errado a quem compra:
//   - comparar "é o mesmo dia?" sem o mês ou sem o ano: um cupom que vence no
//     mesmo dia do mês seguinte (ou do ano seguinte) dizia "Vence hoje";
//   - "amanhã" calculado com 23 h (logo depois da meia-noite) ou 25 h (à noite):
//     o cupom do dia seguinte virava "Válido até DD/MM";
//   - testar "vence hoje" antes de "já passou": o cupom que acabou de vencer de
//     manhã continuava dizendo "Vence hoje" à tarde;
//   - tirar a guarda de data ilegível: o formatador lançava erro e derrubava a
//     tela inteira de cupons.
// Todos os instantes são literais em UTC (Brasília = UTC-3), sem depender do
// fuso nem do relógio da máquina.

describe("validadeDoCupom — o mesmo dia do mês não é 'hoje'", () => {
  // 24/11/2026 12:00 em Brasília.
  const agora = new Date("2026-11-24T15:00:00.000Z");

  it("mesmo dia e mês, só que no ano seguinte: mostra a data com o ano", () => {
    expect(validadeDoCupom("2027-11-24T14:00:00.000Z", agora)).toBe(
      "Válido até 24/11/2027",
    );
  });

  it("mesmo dia do mês, no mês seguinte: mostra a data, não 'Vence hoje'", () => {
    expect(validadeDoCupom("2026-12-24T14:00:00.000Z", agora)).toBe(
      "Válido até 24/12",
    );
  });

  it("dia seguinte em outro mês ou outro ano não é 'Vence amanhã'", () => {
    expect(validadeDoCupom("2026-12-25T14:00:00.000Z", agora)).toBe(
      "Válido até 25/12",
    );
    expect(validadeDoCupom("2027-11-25T14:00:00.000Z", agora)).toBe(
      "Válido até 25/11/2027",
    );
  });

  it("controle: o próprio dia e o dia seguinte continuam com a frase curta", () => {
    expect(validadeDoCupom("2026-11-24T20:00:00.000Z", agora)).toBe(
      "Vence hoje",
    );
    expect(validadeDoCupom("2026-11-25T14:00:00.000Z", agora)).toBe(
      "Vence amanhã",
    );
  });
});

describe("validadeDoCupom — 'amanhã' perto da meia-noite de Brasília", () => {
  it("à 00h30 de 24/11, o cupom de 25/11 'Vence amanhã' (e o de 26/11 não)", () => {
    const agora = new Date("2026-11-24T03:30:00.000Z"); // 00:30 BRT
    expect(validadeDoCupom("2026-11-25T14:00:00.000Z", agora)).toBe(
      "Vence amanhã",
    );
    expect(validadeDoCupom("2026-11-26T14:00:00.000Z", agora)).toBe(
      "Válido até 26/11",
    );
  });

  it("às 23h30 de 24/11, o cupom de 25/11 'Vence amanhã' (e o de 26/11 não)", () => {
    const agora = new Date("2026-11-25T02:30:00.000Z"); // 23:30 BRT de 24/11
    expect(validadeDoCupom("2026-11-25T14:00:00.000Z", agora)).toBe(
      "Vence amanhã",
    );
    expect(validadeDoCupom("2026-11-26T14:00:00.000Z", agora)).toBe(
      "Válido até 26/11",
    );
  });
});

describe("validadeDoCupom — o que já passou e o que é ilegível", () => {
  it("venceu hoje de manhã e agora é de tarde: 'Validade', nunca 'Vence hoje'", () => {
    const agora = new Date("2026-11-24T18:00:00.000Z"); // 15:00 BRT
    expect(validadeDoCupom("2026-11-24T13:00:00.000Z", agora)).toBe(
      "Validade: 24/11",
    );
  });

  it("venceu em outro ano: a data traz o ano", () => {
    const agora = new Date("2026-11-24T18:00:00.000Z");
    expect(validadeDoCupom("2025-11-24T13:00:00.000Z", agora)).toBe(
      "Validade: 24/11/2025",
    );
  });

  it("data ilegível vira nulo em vez de derrubar a tela", () => {
    const agora = new Date("2026-11-24T18:00:00.000Z");
    expect(validadeDoCupom("lixo", agora)).toBeNull();
    expect(validadeDoCupom("", agora)).toBeNull();
  });
});
