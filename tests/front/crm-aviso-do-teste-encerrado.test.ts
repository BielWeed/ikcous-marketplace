// A conta que decide se o cartão "Sua assinatura" troca "Atrasada" por "Teste
// encerrado" (26/11/2026). A lojista que só testou e não pagou não é devedora;
// quem deve de verdade NÃO pode ter a dívida amaciada. Por isso o aviso só sai
// com o sinal completo e coerente da gestão (`atrasada`, `teste_ate` igual à
// próxima cobrança, vencimento já chegado em São Paulo, valor > 0 e `pausa_em`
// nulo ou depois do vencimento). Qualquer sinal torto devolve `null`, e o
// cartão continua o de hoje. Dados inventados.
import { avisoDoTesteEncerrado } from "@/lib/crm";
import type { AssinaturaDaLoja } from "@/types/painel";
import { describe, expect, it } from "vitest";

const SINAL: AssinaturaDaLoja = {
  plano: "Plano Inventado",
  status: "atrasada",
  valorMensal: 250,
  ciclo: "mensal",
  inicioEm: "2026-11-26",
  proximaCobrancaEm: "2026-12-03",
  testeAte: "2026-12-03",
  pausaEm: "2026-12-07",
  recursos: [],
  gerenciarUrl: null,
  suporteWhatsapp: null,
  atualizadoEm: null,
};

/** Meio-dia em Brasília (15h UTC) do dia pedido. */
const meioDia = (dia: string) => new Date(`${dia}T15:00:00Z`);

const aviso = (parcial: Partial<AssinaturaDaLoja>, agora: Date) =>
  avisoDoTesteEncerrado({ ...SINAL, ...parcial }, agora);

describe("avisoDoTesteEncerrado: o sinal completo", () => {
  it("antes da pausa traz as datas cheias, com 'pague até' na véspera da pausa", () => {
    expect(aviso({}, meioDia("2026-12-05"))).toEqual({
      venceuEm: "2026-12-03",
      valorMensal: 250,
      pagueAte: "2026-12-06",
      pausaEm: "2026-12-07",
    });
  });

  it("no próprio dia do vencimento já é teste encerrado", () => {
    expect(aviso({}, meioDia("2026-12-03"))).toEqual({
      venceuEm: "2026-12-03",
      valorMensal: 250,
      pagueAte: "2026-12-06",
      pausaEm: "2026-12-07",
    });
  });

  it("na virada: 07/12 02:30 UTC ainda é 06/12 em São Paulo, antes da pausa", () => {
    expect(aviso({}, new Date("2026-12-07T02:30:00Z"))).toEqual({
      venceuEm: "2026-12-03",
      valorMensal: 250,
      pagueAte: "2026-12-06",
      pausaEm: "2026-12-07",
    });
  });

  it("07/12 03:00 UTC já é 07/12 em São Paulo: o dia da pausa, sem datas", () => {
    expect(aviso({}, new Date("2026-12-07T03:00:00Z"))).toEqual({
      venceuEm: "2026-12-03",
      valorMensal: 250,
      pagueAte: null,
      pausaEm: null,
    });
  });

  it("no dia da pausa e depois dela o aviso continua, sem 'pague até' nem pausa", () => {
    for (const dia of ["2026-12-07", "2026-12-08", "2027-02-01"]) {
      expect(aviso({}, meioDia(dia))).toEqual({
        venceuEm: "2026-12-03",
        valorMensal: 250,
        pagueAte: null,
        pausaEm: null,
      });
    }
  });

  it("sem pausa_em (gestão velha ou recuo) o aviso sai sem datas de prazo", () => {
    expect(aviso({ pausaEm: null }, meioDia("2026-12-05"))).toEqual({
      venceuEm: "2026-12-03",
      valorMensal: 250,
      pagueAte: null,
      pausaEm: null,
    });
  });

  it("pausa no dia seguinte ao vencimento: no vencimento, pague até o próprio vencimento", () => {
    expect(aviso({ pausaEm: "2026-12-04" }, meioDia("2026-12-03"))).toEqual({
      venceuEm: "2026-12-03",
      valorMensal: 250,
      pagueAte: "2026-12-03",
      pausaEm: "2026-12-04",
    });
  });

  it("atravessa a virada do ano", () => {
    const anoNovo = {
      proximaCobrancaEm: "2026-12-28",
      testeAte: "2026-12-28",
      pausaEm: "2027-01-04",
    };
    expect(aviso(anoNovo, meioDia("2026-12-30"))).toEqual({
      venceuEm: "2026-12-28",
      valorMensal: 250,
      pagueAte: "2027-01-03",
      pausaEm: "2027-01-04",
    });
    // 01/01 02:59 UTC ainda é 31/12 em São Paulo.
    expect(aviso(anoNovo, new Date("2027-01-01T02:59:00Z"))?.pagueAte).toBe(
      "2027-01-03",
    );
    expect(aviso(anoNovo, meioDia("2027-01-04"))?.pagueAte).toBeNull();
  });

  it("pausa em 1º de março de ano não bissexto: pague até 28/02", () => {
    expect(
      aviso(
        {
          proximaCobrancaEm: "2027-02-20",
          testeAte: "2027-02-20",
          pausaEm: "2027-03-01",
        },
        meioDia("2027-02-25"),
      )?.pagueAte,
    ).toBe("2027-02-28");
  });
});

describe("avisoDoTesteEncerrado: sinal torto cai SEMPRE no cartão de hoje", () => {
  const hoje = meioDia("2026-12-05");

  it("pausa_em igual ou anterior ao vencimento", () => {
    expect(aviso({ pausaEm: "2026-12-03" }, hoje)).toBeNull();
    expect(aviso({ pausaEm: "2026-12-02" }, hoje)).toBeNull();
    expect(aviso({ pausaEm: "2025-12-31" }, hoje)).toBeNull();
  });

  it("pausa_em ilegível, infinita ou dia que não existe", () => {
    for (const torta of [
      "amanhã",
      "infinity",
      "-infinity",
      "2026-02-31",
      "2026-13-01",
      "2026-12-7",
      "07/12/2026",
      "2026-12-07T03:00:00Z",
    ]) {
      expect(aviso({ pausaEm: torta }, hoje)).toBeNull();
    }
  });

  it("teste_ate diferente da próxima cobrança, ou um dos dois nulo", () => {
    expect(aviso({ testeAte: "2026-12-02" }, hoje)).toBeNull();
    expect(aviso({ testeAte: null }, hoje)).toBeNull();
    expect(aviso({ proximaCobrancaEm: null }, hoje)).toBeNull();
    expect(aviso({ testeAte: null, proximaCobrancaEm: null }, hoje)).toBeNull();
  });

  it("teste_ate e próxima iguais mas ilegíveis ou dia inexistente", () => {
    for (const torta of ["amanhã", "infinity", "2026-02-31"]) {
      expect(
        aviso({ testeAte: torta, proximaCobrancaEm: torta }, hoje),
      ).toBeNull();
    }
  });

  it("qualquer status que não seja 'atrasada'", () => {
    for (const status of [
      "teste",
      "ativa",
      "suspensa",
      "pendente",
      "cancelada",
      null,
    ] as const) {
      expect(aviso({ status }, hoje)).toBeNull();
    }
  });

  it("valor nulo, zero, negativo ou não finito", () => {
    for (const valorMensal of [
      null,
      0,
      -250,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(aviso({ valorMensal }, hoje)).toBeNull();
    }
  });

  it("vencimento ainda no futuro (dia de São Paulo)", () => {
    expect(aviso({}, meioDia("2026-12-02"))).toBeNull();
    // 03/12 02:59 UTC ainda é 02/12 em São Paulo: não venceu.
    expect(aviso({}, new Date("2026-12-03T02:59:00Z"))).toBeNull();
    // 03/12 03:00 UTC já é 03/12 em São Paulo: venceu hoje.
    expect(aviso({}, new Date("2026-12-03T03:00:00Z"))).not.toBeNull();
  });
});
