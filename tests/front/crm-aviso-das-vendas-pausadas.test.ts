// A conta que decide se o cartão "Sua assinatura" diz que as vendas pela loja
// ESTÃO pausadas (26/11/2026, decisão da pausa, texto 3). Para pausar, a gestão
// grava `suspensa` (o único status que o banco pausa, migration 20261600000000)
// com os MESMOS dados que levavam a "Mensalidade em aberto" ou "Teste
// encerrado". Sem este aviso, no dia em que os pedidos online param o cartão
// voltava ao genérico "Suspensa / Regularize". Savy e IKCOUS nunca recebem
// `pausa_em`: cartão de hoje. Qualquer sinal torto devolve `null`. Dados
// inventados.
import { avisoDasVendasPausadas } from "@/lib/crm";
import type { AssinaturaDaLoja } from "@/types/painel";
import { describe, expect, it } from "vitest";

const SINAL: AssinaturaDaLoja = {
  plano: "Plano Inventado",
  status: "suspensa",
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
  avisoDasVendasPausadas({ ...SINAL, ...parcial }, agora);

const PAUSADA_PAGANTE = {
  pausadasDesde: "2027-01-13",
  venceuEm: "2027-01-02",
  valorMensal: 250,
  doTeste: false,
};

describe("avisoDasVendasPausadas: suspensa com o sinal completo", () => {
  it("no próprio dia da pausa: pausadas desde pausa_em", () => {
    expect(aviso({}, meioDia("2027-01-13"))).toEqual(PAUSADA_PAGANTE);
  });

  it("dias depois da pausa: a data continua a da pausa", () => {
    expect(aviso({}, meioDia("2027-02-20"))).toEqual(PAUSADA_PAGANTE);
  });

  it("na virada: 13/01 03:00 UTC já é 13/01 em São Paulo", () => {
    expect(aviso({}, new Date("2027-01-13T03:00:00Z"))).toEqual(
      PAUSADA_PAGANTE,
    );
  });

  it("o sinal do teste encerrado (teste_ate = vencimento) também pausa, marcado como teste", () => {
    expect(aviso({ testeAte: "2027-01-02" }, meioDia("2027-01-13"))).toEqual({
      ...PAUSADA_PAGANTE,
      doTeste: true,
    });
  });
});

describe("avisoDasVendasPausadas: na dúvida, nada (o cartão de hoje)", () => {
  it("antes do dia da pausa: o banco ainda não pausou", () => {
    expect(aviso({}, meioDia("2027-01-12"))).toBeNull();
    expect(aviso({}, new Date("2027-01-13T02:59:00Z"))).toBeNull();
  });

  it("sem pausa_em (Savy, IKCOUS ou gestão velha)", () => {
    expect(aviso({ pausaEm: null }, meioDia("2027-02-20"))).toBeNull();
    expect(
      aviso({ pausaEm: null, testeAte: "2027-01-02" }, meioDia("2027-02-20")),
    ).toBeNull();
  });

  it("pausa_em igual ou anterior ao vencimento, ilegível ou dia que não existe", () => {
    for (const pausaEm of [
      "2027-01-02",
      "2026-12-31",
      "amanhã",
      "2027-02-31",
    ]) {
      expect(aviso({ pausaEm }, meioDia("2027-02-20"))).toBeNull();
    }
  });

  it("sem vencimento ou vencimento ilegível", () => {
    for (const proximaCobrancaEm of [null, "ontem", "2027-02-30"]) {
      expect(aviso({ proximaCobrancaEm }, meioDia("2027-02-20"))).toBeNull();
    }
  });

  it("teste_ate preenchido e diferente do vencimento (sinal torto)", () => {
    expect(aviso({ testeAte: "2027-01-01" }, meioDia("2027-02-20"))).toBeNull();
    expect(aviso({ testeAte: "lixo" }, meioDia("2027-02-20"))).toBeNull();
  });

  it("valor nulo, zero, negativo ou não finito", () => {
    for (const valorMensal of [
      null,
      0,
      -250,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(aviso({ valorMensal }, meioDia("2027-02-20"))).toBeNull();
    }
  });

  it("qualquer status que não seja 'suspensa'", () => {
    for (const status of [
      "ativa",
      "atrasada",
      "teste",
      "pendente",
      "cancelada",
      null,
    ] as const) {
      expect(aviso({ status }, meioDia("2027-02-20"))).toBeNull();
    }
  });
});
