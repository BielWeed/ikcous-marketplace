import { formasPagamentoNaEntregaValidas } from "@/lib/formas-de-pagamento-na-entrega";
// FORMAS DE PAGAMENTO POR LOJA (25/09/2026): a normalização do que vem do
// banco (StoreContext.mapConfig) ou do cache offline (DataVault) para a
// lista de formas "na entrega" que a loja realmente aceita. Ausente,
// inválido (não-array) ou com QUALQUER elemento fora do conjunto conhecido
// cai no PADRÃO — as três, o MESMO comportamento de hoje (loja velha sem a
// coluna, ou linha corrompida, nunca muda de comportamento sozinha).
import { describe, expect, it } from "vitest";

describe("formasPagamentoNaEntregaValidas", () => {
  it("ausente (undefined) -> as três, ordem canônica", () => {
    expect(formasPagamentoNaEntregaValidas(undefined)).toEqual([
      "pix",
      "card",
      "cash",
    ]);
  });

  it("null -> as três", () => {
    expect(formasPagamentoNaEntregaValidas(null)).toEqual([
      "pix",
      "card",
      "cash",
    ]);
  });

  it("não-array (string, number, objeto) -> as três", () => {
    expect(formasPagamentoNaEntregaValidas("pix")).toEqual([
      "pix",
      "card",
      "cash",
    ]);
    expect(formasPagamentoNaEntregaValidas(42)).toEqual([
      "pix",
      "card",
      "cash",
    ]);
    expect(formasPagamentoNaEntregaValidas({ pix: true })).toEqual([
      "pix",
      "card",
      "cash",
    ]);
  });

  it("array vazio -> preserva vazio (loja que só vende pelo app)", () => {
    expect(formasPagamentoNaEntregaValidas([])).toEqual([]);
  });

  it("subconjunto válido preserva a ORDEM que veio (o servidor nunca reordena)", () => {
    expect(formasPagamentoNaEntregaValidas(["cash", "pix"])).toEqual([
      "cash",
      "pix",
    ]);
  });

  it("um único elemento válido", () => {
    expect(formasPagamentoNaEntregaValidas(["card"])).toEqual(["card"]);
  });

  it("as três, em ordem canônica", () => {
    expect(formasPagamentoNaEntregaValidas(["pix", "card", "cash"])).toEqual([
      "pix",
      "card",
      "cash",
    ]);
  });

  // O CASO QUE DÓI: um elemento fora do conjunto (typo, migração malfeita,
  // dado de versão futura) NÃO filtra em silêncio — cairia para
  // ["pix","card"] sem ninguém perceber que "cash" sumiu por acidente.
  // Falha para o PADRÃO inteiro: mais seguro assumir "não sei" do que
  // "sei, e é isto".
  it("elemento desconhecido no meio -> falha para o PADRÃO inteiro, não filtra em silêncio", () => {
    expect(
      formasPagamentoNaEntregaValidas(["pix", "whatsapp", "cash"]),
    ).toEqual(["pix", "card", "cash"]);
  });

  it("elemento 'online' dentro do array (contrato errado — online não é 'na entrega') -> PADRÃO", () => {
    expect(formasPagamentoNaEntregaValidas(["online"])).toEqual([
      "pix",
      "card",
      "cash",
    ]);
  });

  it("duplicata no array (não deveria acontecer — o banco recusa — mas o front não trava por causa disso)", () => {
    expect(formasPagamentoNaEntregaValidas(["pix", "pix"])).toEqual([
      "pix",
      "pix",
    ]);
  });
});
