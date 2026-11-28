// CHAVE DA COMPRA — a RECOTAÇÃO do frete não é compra nova (lote 569, 28/11/2026).
//
// O cenário: a cliente toca em Finalizar, o pedido nasce no banco e a página
// morre antes da resposta (o iPhone fecha o app, a aba recarrega). A chave
// sobrevive no localStorage (30 min) e o carrinho também; a opção de frete
// escolhida NÃO (mora em memória): ao voltar, a calculadora cota de novo. Se o
// preço da MESMA opção, para o MESMO destino, voltar diferente, frete e total
// mudavam juntos, a impressão mudava, a chave girava e o novo Finalizar criava
// um SEGUNDO pedido pendente.
//
// O que a impressão passa a ver é o valor dos ITENS (total menos frete), não o
// preço cotado. O que muda a compra continua girando a chave: a opção de
// frete, o destino, o cupom, os itens, o preço dos itens.
import { describe, expect, it } from "vitest";

import {
  type CompraParaImpressao,
  criarGerenciadorDeChave,
  impressaoDaCompra,
} from "@/lib/chave-do-pedido";

const base: CompraParaImpressao = {
  items: [{ product_id: "prod-a", variant_id: null, quantity: 2 }],
  totalAmount: 120,
  shippingCost: 20,
  destinationCep: "38500000",
  shippingOptionId: "1",
  couponCode: null,
  addressId: "end-1",
  cepDoEndereco: null,
  paymentMethod: "online",
};

function com(mudanca: Partial<CompraParaImpressao>): CompraParaImpressao {
  return { ...base, ...mudanca };
}

function armazenamentoEmMemoria() {
  const dados = new Map<string, string>();
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    removeItem: (k: string) => void dados.delete(k),
  };
}

describe("impressaoDaCompra — frete recotado para a MESMA opção e o MESMO destino", () => {
  it("frete e total sobem juntos: mesma impressão", () => {
    const recotada = com({ shippingCost: 23.5, totalAmount: 123.5 });
    expect(impressaoDaCompra(recotada)).toBe(impressaoDaCompra(base));
  });

  it("frete e total descem juntos (até frete zero): mesma impressão", () => {
    const gratis = com({ shippingCost: 0, totalAmount: 100 });
    expect(impressaoDaCompra(gratis)).toBe(impressaoDaCompra(base));
  });

  it("ruído de ponto flutuante na subtração não gira a chave", () => {
    const sujo = com({ shippingCost: 20.1, totalAmount: 100 + 20.1 });
    const limpo = com({ shippingCost: 20.1, totalAmount: 120.1 });
    expect(impressaoDaCompra(sujo)).toBe(impressaoDaCompra(limpo));
    expect(impressaoDaCompra(limpo)).toBe(impressaoDaCompra(base));
  });

  it("a página morta e reaberta repete a MESMA chave com o frete recotado (o banco devolve o pedido que já nasceu)", () => {
    const armazenamento = armazenamentoEmMemoria();
    let n = 0;
    const gerar = () => `chave-${++n}`;
    const antes = criarGerenciadorDeChave(armazenamento, gerar, {
      dono: "conta-1",
    });
    const primeira = antes.chavePara(impressaoDaCompra(base));

    // Outra instância (a página nova), só o armazenamento em comum.
    const depois = criarGerenciadorDeChave(armazenamento, gerar, {
      dono: "conta-1",
    });
    const recotada = com({ shippingCost: 26.9, totalAmount: 126.9 });
    expect(depois.chavePara(impressaoDaCompra(recotada))).toBe(primeira);
    expect(n).toBe(1);
  });
});

describe("impressaoDaCompra — o que continua sendo compra nova", () => {
  const original = impressaoDaCompra(base);
  const mudancas: Array<[string, Partial<CompraParaImpressao>]> = [
    ["opção de frete (mesmo preço)", { shippingOptionId: "2" }],
    ["destino do frete", { destinationCep: "01001000" }],
    ["preço dos itens (frete igual)", { totalAmount: 125 }],
    [
      "preço dos itens com frete recotado",
      { totalAmount: 130, shippingCost: 25 },
    ],
    ["cupom", { couponCode: "BEMVINDO", totalAmount: 110 }],
  ];
  for (const [nome, mudanca] of mudancas) {
    it(`mudou o(a) ${nome} -> impressão DIFERENTE`, () => {
      expect(impressaoDaCompra(com(mudanca))).not.toBe(original);
    });
  }
});
