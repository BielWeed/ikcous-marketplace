// Teto de valor e parcela mínima do painel financeiro (lote r130-c).
//
// O campo de valor usa máscara de moeda sem `maxLength`; o banco só recusa
// acima de R$ 9.999.999.999,99. Quem segura a faixa de R$ 100 milhões a
// R$ 10 bilhões é o teto de R$ 99.999.999,99 do front (`validarLancamento`,
// `validarConta`). E um valor parcelado com menos centavos que parcelas daria
// parcelas de R$ 0,00 no banco: a frase clara sai do front, antes da RPC.
// O bloco 'formulários' de financeiro-lib.test.ts não usa valor acima do teto
// nem a borda centavos = parcelas.
import { describe, expect, it } from "vitest";

import {
  formularioInicialDoLancamento,
  validarConta,
  validarLancamento,
} from "@/lib/financeiro";

const hoje = "2026-09-26";

const lancamento = (valor: string, extra = {}) =>
  formularioInicialDoLancamento(hoje, {
    valor,
    descricao: "Fornecedor",
    categoriaId: "cat",
    contaId: "banco",
    ...extra,
  });

const conta = (saldoInicial: string) => ({
  nome: "Cofre",
  tipo: "outro" as const,
  saldoInicial,
  saldoInicialEm: "2026-09-01",
  ativa: true,
});

describe("teto de valor do lançamento", () => {
  it("R$ 100.000.000,00 é recusado com a frase do limite, e só o campo valor", () => {
    expect(validarLancamento(lancamento("100.000.000,00"), hoje)).toEqual({
      ok: false,
      erros: { valor: "Valor acima do limite de R$ 99.999.999,99." },
    });
  });

  it("controle: R$ 99.999.999,99 (o teto exato) passa e vai no payload", () => {
    expect(validarLancamento(lancamento("99.999.999,99"), hoje)).toMatchObject({
      ok: true,
      payload: { valor: 99999999.99 },
    });
  });
});

describe("teto do saldo inicial da conta", () => {
  it.each(["100000000", "-100000000"])(
    "saldo inicial %s é recusado com 'Valor acima do limite.'",
    (saldo) => {
      expect(validarConta(conta(saldo))).toEqual({
        ok: false,
        erros: { saldoInicial: "Valor acima do limite." },
      });
    },
  );

  it.each(["99999999.99", "-99999999.99"])(
    "controle: saldo inicial %s (o teto exato, nos dois sinais) passa",
    (saldo) => {
      expect(validarConta(conta(saldo))).toMatchObject({
        ok: true,
        payload: { saldo_inicial: Number(saldo) },
      });
    },
  );
});

describe("parcela mínima de R$ 0,01", () => {
  const previsto = (valor: string, parcelas: string) =>
    lancamento(valor, {
      situacao: "previsto",
      dataVencimento: "2026-10-05",
      parcelas,
    });

  it.each([
    ["0,10", "48"],
    ["0,03", "4"],
  ])("R$ %s em %sx é recusado (menos centavos que parcelas)", (valor, n) => {
    expect(validarLancamento(previsto(valor, n), hoje)).toEqual({
      ok: false,
      erros: { parcelas: "Cada parcela precisa de pelo menos R$ 0,01." },
    });
  });

  it("controle: R$ 0,48 em 48x (exatamente R$ 0,01 por parcela) passa com parcelas: 48", () => {
    expect(validarLancamento(previsto("0,48", "48"), hoje)).toMatchObject({
      ok: true,
      payload: { valor: 0.48, parcelas: 48 },
    });
  });

  it("controle: R$ 0,04 em 4x também passa (a borda é centavos = parcelas)", () => {
    expect(validarLancamento(previsto("0,04", "4"), hoje)).toMatchObject({
      ok: true,
      payload: { valor: 0.04, parcelas: 4 },
    });
  });
});
