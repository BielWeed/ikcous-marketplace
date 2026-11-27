// O texto "Termina hoje / amanhã" só vale para o MESMO dia do calendário: o mesmo
// número de dia em outro mês (24/12 visto em 24/11) é daqui a um mês, e dizer
// "hoje" faria a lojista deixar o banner correndo sem perceber o prazo. Também a
// virada de mês e de ano no "amanhã", e a programação com datas em branco.
//
// Relógio fixo, no horário de Brasília: `agora` é passado e nunca lido do
// sistema, e as datas valem em qualquer fuso do computador.
import { estaNoAr, fimDoBannerEmTexto } from "@/lib/datas-do-banner";
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

const iso = (ano: number, mes: number, dia: number, hora = 12, minuto = 0) =>
  brasilia(ano, mes - 1, dia, hora, minuto).toISOString();

describe("o fim do banner em palavras, no calendário", () => {
  it("mesmo número de dia em OUTRO mês não é 'hoje'", () => {
    const agora = brasilia(2026, 10, 24, 10, 0); // 24/11/2026
    expect(fimDoBannerEmTexto(iso(2026, 12, 24), agora)).toBe(
      "Termina em 24/12 às 12:00.",
    );
  });

  it("o dia seguinte em OUTRO mês não é 'amanhã'", () => {
    const agora = brasilia(2026, 10, 24, 10, 0); // 24/11/2026
    expect(fimDoBannerEmTexto(iso(2026, 12, 25), agora)).toBe(
      "Termina em 25/12 às 12:00.",
    );
  });

  it("mesmo dia e mês em OUTRO ano mostra o ano", () => {
    const agora = brasilia(2026, 10, 24, 10, 0);
    expect(fimDoBannerEmTexto(iso(2027, 11, 24), agora)).toBe(
      "Termina em 24/11/2027 às 12:00.",
    );
  });

  it("o último dia do mês vê o dia 1 do mês seguinte como 'amanhã'", () => {
    const agora = brasilia(2026, 10, 30, 10, 0); // 30/11/2026
    expect(fimDoBannerEmTexto(iso(2026, 12, 1), agora)).toBe(
      "Termina amanhã às 12:00.",
    );
  });

  it("31/12 vê 01/01 do ano seguinte como 'amanhã'", () => {
    const agora = brasilia(2026, 11, 31, 10, 0);
    expect(fimDoBannerEmTexto(iso(2027, 1, 1), agora)).toBe(
      "Termina amanhã às 12:00.",
    );
  });

  it("hoje e amanhã continuam certos no meio do mês", () => {
    const agora = brasilia(2026, 10, 24, 10, 0);
    expect(fimDoBannerEmTexto(iso(2026, 11, 24, 18, 5), agora)).toBe(
      "Termina hoje às 18:05.",
    );
    expect(fimDoBannerEmTexto(iso(2026, 11, 25, 9, 30), agora)).toBe(
      "Termina amanhã às 09:30.",
    );
  });

  it("o que já passou diz 'Já terminou', com o dia e o mês certos", () => {
    const agora = brasilia(2026, 10, 24, 10, 0);
    expect(fimDoBannerEmTexto(iso(2026, 10, 24), agora)).toBe(
      "Já terminou em 24/10 às 12:00.",
    );
  });
});

describe("a programação com datas em branco", () => {
  const agora = brasilia(2026, 10, 24, 10, 0);

  it("início e fim vazios (texto vazio) valem como 'sem data': no ar", () => {
    expect(estaNoAr({ active: true, startDate: "", endDate: "" }, agora)).toBe(
      true,
    );
    expect(
      estaNoAr({ active: true, startDate: null, endDate: null }, agora),
    ).toBe(true);
    expect(estaNoAr({ active: true }, agora)).toBe(true);
  });

  it("só início: começa no instante; só fim: acaba no instante", () => {
    const antes = brasilia(2026, 10, 24, 9, 59);
    const inicio = iso(2026, 11, 24, 10, 0);
    expect(estaNoAr({ active: true, startDate: inicio }, antes)).toBe(false);
    expect(estaNoAr({ active: true, startDate: inicio }, agora)).toBe(true);
    expect(estaNoAr({ active: true, endDate: inicio }, agora)).toBe(true);
    expect(
      estaNoAr(
        { active: true, endDate: inicio },
        brasilia(2026, 10, 24, 10, 1),
      ),
    ).toBe(false);
  });

  it("desligado nunca está no ar, mesmo dentro das datas", () => {
    expect(
      estaNoAr(
        {
          active: false,
          startDate: iso(2026, 11, 1),
          endDate: iso(2026, 12, 1),
        },
        agora,
      ),
    ).toBe(false);
  });
});
