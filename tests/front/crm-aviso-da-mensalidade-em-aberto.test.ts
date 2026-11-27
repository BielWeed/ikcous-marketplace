// A conta que decide se o cartão "Sua assinatura" troca "Atrasada" por
// "Mensalidade em aberto" (26/11/2026, decisão "sem teste grátis"). A lojista
// que entrou pagando e atrasou recebe da gestão o `pausa_em` com `teste_ate`
// nulo: o cartão diz o prazo com a mesma data do WhatsApp. Savy e IKCOUS nunca
// recebem `pausa_em`, então seguem com o cartão de hoje. Qualquer sinal torto
// devolve `null` e o cartão continua o de hoje. Dados inventados.
import { avisoDaMensalidadeEmAberto } from "@/lib/crm";
import type { AssinaturaDaLoja } from "@/types/painel";
import { describe, expect, it } from "vitest";

const SINAL: AssinaturaDaLoja = {
  plano: "Plano Inventado",
  status: "atrasada",
  valorMensal: 250,
  ciclo: "mensal",
  inicioEm: "2026-12-02",
  proximaCobrancaEm: "2027-01-02",
  testeAte: null,
  pausaEm: "2027-01-13",
  recursos: [],
  gerenciarUrl: null,
  suporteWhatsapp: null,
  atualizadoEm: null,
};

/** Meio-dia em Brasília (15h UTC) do dia pedido. */
const meioDia = (dia: string) => new Date(`${dia}T15:00:00Z`);

const aviso = (parcial: Partial<AssinaturaDaLoja>, agora: Date) =>
  avisoDaMensalidadeEmAberto({ ...SINAL, ...parcial }, agora);

const COM_PRAZO = {
  venceuEm: "2027-01-02",
  valorMensal: 250,
  pagueAte: "2027-01-12",
  pausaEm: "2027-01-13",
};
const SEM_PRAZO = {
  venceuEm: "2027-01-02",
  valorMensal: 250,
  pagueAte: null,
  pausaEm: null,
};

describe("avisoDaMensalidadeEmAberto: o sinal completo da pagante", () => {
  it("antes da pausa: 'pague até' é a véspera da pausa", () => {
    expect(aviso({}, meioDia("2027-01-05"))).toEqual(COM_PRAZO);
  });

  it("no próprio dia do vencimento o aviso já sai, com o prazo", () => {
    expect(aviso({}, meioDia("2027-01-02"))).toEqual(COM_PRAZO);
  });

  it("na véspera da pausa ainda traz o prazo", () => {
    expect(aviso({}, meioDia("2027-01-12"))).toEqual(COM_PRAZO);
  });

  it("na virada: 13/01 02:59 UTC ainda é 12/01 em São Paulo", () => {
    expect(aviso({}, new Date("2027-01-13T02:59:00Z"))).toEqual(COM_PRAZO);
  });

  it("13/01 03:00 UTC já é o dia da pausa: o aviso continua, sem datas", () => {
    expect(aviso({}, new Date("2027-01-13T03:00:00Z"))).toEqual(SEM_PRAZO);
  });

  it("no dia da pausa e depois dele o aviso continua, sem 'pague até' nem pausa", () => {
    for (const dia of ["2027-01-13", "2027-01-20", "2027-03-01"]) {
      expect(aviso({}, meioDia(dia))).toEqual(SEM_PRAZO);
    }
  });

  it("pausa no dia seguinte ao vencimento: no vencimento, pague até o próprio vencimento", () => {
    expect(aviso({ pausaEm: "2027-01-03" }, meioDia("2027-01-02"))).toEqual({
      ...COM_PRAZO,
      pagueAte: "2027-01-02",
      pausaEm: "2027-01-03",
    });
  });

  it("pausa em 1º de março de ano não bissexto: pague até 28/02", () => {
    expect(
      aviso(
        { proximaCobrancaEm: "2027-02-18", pausaEm: "2027-03-01" },
        meioDia("2027-02-25"),
      )?.pagueAte,
    ).toBe("2027-02-28");
  });

  it("vencimento no fim do ano e pausa no ano novo", () => {
    expect(
      aviso(
        { proximaCobrancaEm: "2026-12-28", pausaEm: "2027-01-08" },
        meioDia("2026-12-30"),
      ),
    ).toEqual({
      venceuEm: "2026-12-28",
      valorMensal: 250,
      pagueAte: "2027-01-07",
      pausaEm: "2027-01-08",
    });
  });
});

describe("avisoDaMensalidadeEmAberto: sinal torto cai SEMPRE no cartão de hoje", () => {
  const hoje = meioDia("2027-01-05");

  it("sem pausa_em (Savy, IKCOUS, gestão velha ou recuo)", () => {
    expect(aviso({ pausaEm: null }, hoje)).toBeNull();
  });

  it("teste_ate preenchido: a loja segue com o aviso do teste", () => {
    // Igual à próxima cobrança (teste encerrado) ou qualquer outro valor.
    expect(aviso({ testeAte: "2027-01-02" }, hoje)).toBeNull();
    expect(aviso({ testeAte: "2026-12-09" }, hoje)).toBeNull();
    expect(aviso({ testeAte: "amanhã" }, hoje)).toBeNull();
    expect(aviso({ testeAte: "" }, hoje)).toBeNull();
  });

  it("pausa_em igual ou anterior ao vencimento", () => {
    expect(aviso({ pausaEm: "2027-01-02" }, hoje)).toBeNull();
    expect(aviso({ pausaEm: "2027-01-01" }, hoje)).toBeNull();
    expect(aviso({ pausaEm: "2025-12-31" }, hoje)).toBeNull();
  });

  it("pausa_em ilegível, infinita ou dia que não existe", () => {
    for (const torta of [
      "",
      "amanhã",
      "infinity",
      "-infinity",
      "2027-02-31",
      "2027-13-01",
      "2027-01-3",
      "13/01/2027",
      "2027-01-13T03:00:00Z",
    ]) {
      expect(aviso({ pausaEm: torta }, hoje)).toBeNull();
    }
  });

  it("vencimento nulo, ilegível ou dia que não existe", () => {
    for (const torta of [
      null,
      "",
      "amanhã",
      "infinity",
      "2027-02-31",
      "2027-01-02T03:00:00Z",
    ]) {
      expect(aviso({ proximaCobrancaEm: torta }, hoje)).toBeNull();
    }
  });

  it("vencimento ainda no futuro (dia de São Paulo)", () => {
    expect(aviso({}, meioDia("2027-01-01"))).toBeNull();
    // 02/01 02:59 UTC ainda é 01/01 em São Paulo: não venceu.
    expect(aviso({}, new Date("2027-01-02T02:59:00Z"))).toBeNull();
    // 02/01 03:00 UTC já é 02/01 em São Paulo: venceu hoje.
    expect(aviso({}, new Date("2027-01-02T03:00:00Z"))).toEqual(COM_PRAZO);
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

  it("qualquer status que não seja 'atrasada'", () => {
    for (const status of [
      "ativa",
      "suspensa",
      "teste",
      "pendente",
      "cancelada",
      null,
    ] as const) {
      expect(aviso({ status }, hoje)).toBeNull();
    }
  });
});
