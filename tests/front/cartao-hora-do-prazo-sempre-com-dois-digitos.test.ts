// PRAZO DA RESERVA NA TELA DO CARTÃO — a hora que o cliente lê em "Prazo
// informado: até 09:05" (`formatarHoraDoPrazo`) e a leitura do instante que
// vem do Postgres (`lerPrazoEmMs`).
//
// Buraco achado por mutação: trocar `hour: "2-digit"` por `"numeric"` não
// derrubava teste nenhum, e em pt-BR isso vira "9:05" (sem o zero) — a tela do
// cartão passaria a escrever a hora de um jeito diferente do PIX e do resto do
// app. Os testes antigos só usavam horários de duas casas (12:30).
//
// O instante é montado com o relógio LOCAL (`new Date(a, m, d, h, min)`), então
// o teste vale em qualquer fuso em que o CI rode.
import { describe, expect, it } from "vitest";

import {
  formatarHoraDoPrazo,
  lerPrazoEmMs,
} from "@/components/checkout/mensagens-do-cartao";

describe("formatarHoraDoPrazo — a hora do prazo sai sempre HH:MM", () => {
  it("antes das dez da manhã mantém o zero à esquerda (09:05, não 9:05)", () => {
    const ms = new Date(2026, 9, 16, 9, 5).getTime();
    expect(formatarHoraDoPrazo(ms)).toBe("09:05");
  });

  it("meia-noite e meio-dia seguem o relógio de 24 horas", () => {
    expect(formatarHoraDoPrazo(new Date(2026, 9, 16, 0, 0).getTime())).toBe(
      "00:00",
    );
    expect(formatarHoraDoPrazo(new Date(2026, 9, 16, 12, 30).getTime())).toBe(
      "12:30",
    );
    expect(formatarHoraDoPrazo(new Date(2026, 9, 16, 23, 59).getTime())).toBe(
      "23:59",
    );
  });
});

describe("lerPrazoEmMs — o instante preservado, e nunca inventado", () => {
  it("fração do Postgres de 6 dígitos mantém o instante em milissegundos", () => {
    expect(lerPrazoEmMs("2026-10-16T12:30:00.123456Z")).toBe(
      Date.parse("2026-10-16T12:30:00.123Z"),
    );
  });

  it("fração curta é completada com zeros À DIREITA (.5 vale 500 ms, não 5 ms)", () => {
    expect(lerPrazoEmMs("2026-10-16T12:30:00.5Z")).toBe(
      Date.parse("2026-10-16T12:30:00.500Z"),
    );
  });

  it("fuso com deslocamento também é normalizado sem mudar o instante", () => {
    expect(lerPrazoEmMs("2026-10-16T09:30:00.987654-03:00")).toBe(
      Date.parse("2026-10-16T12:30:00.987Z"),
    );
  });

  it("BORDA: vazio, só espaços, lixo e tipo errado são 'sem prazo' (null)", () => {
    for (const valor of ["", "   ", "amanha de manha", undefined, null, 42]) {
      expect(lerPrazoEmMs(valor)).toBeNull();
    }
  });
});
