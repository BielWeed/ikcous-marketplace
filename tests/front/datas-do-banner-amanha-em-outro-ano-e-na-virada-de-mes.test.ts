// "Termina amanhã às HH:MM" (`fimDoBannerEmTexto`) calcula o dia seguinte com o
// calendário de Brasília (27/11/2026; antes, o LOCAL da lojista). Caça por mutação (25/11/2026): trocar o ano do
// cálculo por um número fixo (2026) deixava todos os testes verdes, porque todos
// usavam um "agora" de 2026. A frase tem de valer em qualquer ano e na virada de
// mês e de ano (31/12 -> 01/01, 28/02 -> 01/03 em ano comum, 29/02 em bissexto).
// As datas são montadas no horário de Brasília, então o teste vale em qualquer
// fuso do computador.
import { fimDoBannerEmTexto } from "@/lib/datas-do-banner";
import { describe, expect, it } from "vitest";

// Dia e hora do relógio de BRASÍLIA (UTC-03:00, sem horário de verão), mês de
// 0 a 11: o texto do fim usa o calendário da loja em qualquer aparelho.
const brasilia = (
  ano: number,
  mes0: number,
  dia: number,
  hora = 0,
  minuto = 0,
  segundo = 0,
  ms = 0,
) => new Date(Date.UTC(ano, mes0, dia, hora + 3, minuto, segundo, ms));

const iso = (ano: number, mes: number, dia: number, h: number, min: number) =>
  brasilia(ano, mes - 1, dia, h, min).toISOString();

describe("fimDoBannerEmTexto: 'amanhã' em qualquer ano", () => {
  it.each([
    ["ano seguinte ao fixo", [2027, 3, 10], [2027, 3, 11]],
    ["ano anterior ao fixo", [2025, 6, 15], [2025, 6, 16]],
    ["virada de ano (31/12 -> 01/01)", [2026, 12, 31], [2027, 1, 1]],
    ["virada de mês de 30 dias (30/04 -> 01/05)", [2028, 4, 30], [2028, 5, 1]],
    [
      "fim de fevereiro em ano comum (28/02 -> 01/03)",
      [2027, 2, 28],
      [2027, 3, 1],
    ],
    [
      "fim de fevereiro em bissexto (28/02 -> 29/02)",
      [2028, 2, 28],
      [2028, 2, 29],
    ],
  ] as const)("%s: termina amanhã", (_nome, [ay, am, ad], [fy, fm, fd]) => {
    const agora = brasilia(ay, am - 1, ad, 10, 0);

    expect(fimDoBannerEmTexto(iso(fy, fm, fd, 9, 5), agora)).toBe(
      "Termina amanhã às 09:05.",
    );
  });

  it("dois dias depois (e não amanhã) mostra a data, com o ano só se mudou", () => {
    const agora = brasilia(2027, 11, 30, 10, 0);

    expect(fimDoBannerEmTexto(iso(2028, 1, 1, 9, 5), agora)).toBe(
      "Termina em 01/01/2028 às 09:05.",
    );
    expect(fimDoBannerEmTexto(iso(2027, 12, 31, 18, 0), agora)).toBe(
      "Termina amanhã às 18:00.",
    );
  });

  it("o mesmo dia ainda é 'hoje' e o dia anterior já 'terminou'", () => {
    const agora = brasilia(2027, 2, 10, 10, 0);

    expect(fimDoBannerEmTexto(iso(2027, 3, 10, 23, 59), agora)).toBe(
      "Termina hoje às 23:59.",
    );
    expect(fimDoBannerEmTexto(iso(2027, 3, 9, 23, 59), agora)).toBe(
      "Já terminou em 09/03 às 23:59.",
    );
  });
});
