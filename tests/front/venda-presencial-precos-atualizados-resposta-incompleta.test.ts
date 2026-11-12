import { describe, expect, it } from "vitest";

import {
  type EstadoDaVenda,
  chaveDoItemDoCupom,
  estadoInicialDaVenda,
  reducerDaVenda,
  totalDaVenda,
} from "@/hooks/useVendaPresencial";

function estadoComDoisItens(): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => "venda-precos"),
    itens: [
      {
        chave: chaveDoItemDoCupom("prod-caneca", null),
        productId: "prod-caneca",
        variantId: null,
        nome: "Caneca",
        variacao: null,
        preco: 20,
        quantidade: 2,
        estoque: 5,
        imagem: "",
      },
      {
        chave: chaveDoItemDoCupom("prod-camiseta", "var-pp"),
        productId: "prod-camiseta",
        variantId: "var-pp",
        nome: "Camiseta",
        variacao: "Tamanho PP",
        preco: 50,
        quantidade: 1,
        estoque: 3,
        imagem: "",
      },
    ],
    pagamento: "cash",
    desconto: 5,
    motivoDoDesconto: "Desconto de teste",
  };
}

const precosCompletos = [
  { product_id: "prod-caneca", variant_id: null, price: 25 },
  { product_id: "prod-camiseta", variant_id: "var-pp", price: 60 },
];

describe("preços atualizados do cupom presencial", () => {
  // Remover a guarda de completude deixa o segundo preço indefinido e o total NaN.
  it("recusa a resposta incompleta sem alterar nenhum preço nem o total", () => {
    const estado = estadoComDoisItens();
    expect(totalDaVenda(estado)).toBe(85);

    const atualizado = reducerDaVenda(estado, {
      tipo: "precos_atualizados",
      chaveDeIdempotencia: estado.chaveDeIdempotencia,
      itens: [precosCompletos[0]],
    });

    expect(atualizado.itens.map((item) => item.preco)).toEqual([20, 50]);
    expect(atualizado).toBe(estado);
    expect(atualizado.itens.every((item) => Number.isFinite(item.preco))).toBe(
      true,
    );
    expect(Number.isFinite(totalDaVenda(atualizado))).toBe(true);
    expect(totalDaVenda(atualizado)).toBe(85);
  });

  it("atualiza ambos os preços na resposta completa e recalcula o total", () => {
    const estado = estadoComDoisItens();
    const atualizado = reducerDaVenda(estado, {
      tipo: "precos_atualizados",
      chaveDeIdempotencia: estado.chaveDeIdempotencia,
      itens: precosCompletos,
    });

    expect(atualizado.itens).toEqual([
      { ...estado.itens[0], preco: 25 },
      { ...estado.itens[1], preco: 60 },
    ]);
    expect(totalDaVenda(atualizado)).toBe(105);
    expect(estado.itens.map((item) => item.preco)).toEqual([20, 50]);
    expect(totalDaVenda(estado)).toBe(85);
  });
});
