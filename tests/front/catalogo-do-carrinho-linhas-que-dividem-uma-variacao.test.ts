// Caça de provas fracas (carrinho, 24/11/2026): produto de cadastro antigo com
// DUAS escolhas separadas (cor + tamanho) pode ter duas linhas no carrinho que
// usam a MESMA variação (Azul-P e Azul-M dividem o estoque do azul). O teste
// existente só cobria linhas de variações DIFERENTES, e tirar o desconto do que
// a linha anterior já leva passava a suíte inteira. O que isto protege, quando
// o carrinho relê o catálogo:
//   - a segunda linha leva só o que sobrou do estoque compartilhado (o servidor
//     baixa todas as linhas contra o mesmo id e recusaria o pedido no fim);
//   - o aviso à cliente diz que a segunda linha foi ajustada, e só ela.
import {
  aplicarCatalogoAoCarrinho,
  avisosDoCarrinho,
  montarCatalogo,
} from "@/lib/catalogo-do-carrinho";
import { mapProductFromDB } from "@/lib/mappers";
import type { CartItem } from "@/types";
import { describe, expect, it } from "vitest";

type Linha = Record<string, unknown>;

const produtoDoBanco: Linha = {
  id: "a",
  nome: "Camiseta",
  preco_venda: 10,
  estoque: 10,
  ativo: true,
  imagens: [],
  categoria: "geral",
};
const variacao = (
  id: string,
  nome: string,
  valor: string,
  estoque: number,
): Linha => ({
  id,
  product_id: "a",
  name: nome,
  value: valor,
  stock_increment: estoque,
  price_override: null,
  active: true,
});
// O azul tem 5 no estoque; o P e o M, 10 cada.
const variacoes = [
  variacao("AZUL", "Cor", "Azul", 5),
  variacao("P", "Tamanho", "P", 10),
  variacao("M", "Tamanho", "M", 10),
];
const linhaDeCarrinho = (tamanho: "P" | "M", quantity: number): CartItem => ({
  product: mapProductFromDB({
    ...produtoDoBanco,
    product_variants: variacoes,
  }),
  quantity,
  variantId: "AZUL",
  outrasVariantIds: [tamanho],
  variantNames: `Cor: Azul, Tamanho: ${tamanho}`,
  lastModifiedAt: 1000,
});

describe("carrinho relendo o catálogo: duas linhas que dividem a mesma variação", () => {
  it("Azul-P x4 e Azul-M x4 com 5 azuis: a segunda linha desce para 1", () => {
    const itens = [linhaDeCarrinho("P", 4), linhaDeCarrinho("M", 4)];
    const catalogo = montarCatalogo(["a"], [produtoDoBanco], variacoes);

    const r = aplicarCatalogoAoCarrinho(itens, catalogo, 5000);

    expect(r.map((i) => [i.outrasVariantIds?.[0], i.quantity])).toEqual([
      ["P", 4],
      ["M", 1],
    ]);
    // Só a linha que mudou de quantidade ganha carimbo novo.
    expect(r.map((i) => i.lastModifiedAt)).toEqual([1000, 5000]);
  });

  it("controle: com 8 azuis as duas linhas cabem e nada muda", () => {
    const comMais = [
      variacao("AZUL", "Cor", "Azul", 8),
      variacao("P", "Tamanho", "P", 10),
      variacao("M", "Tamanho", "M", 10),
    ];
    const itens = [linhaDeCarrinho("P", 4), linhaDeCarrinho("M", 4)].map(
      (i) => ({
        ...i,
        product: mapProductFromDB({
          ...produtoDoBanco,
          product_variants: comMais,
        }),
      }),
    );
    const catalogo = montarCatalogo(["a"], [produtoDoBanco], comMais);

    const r = aplicarCatalogoAoCarrinho(itens, catalogo, 5000);

    expect(r.map((i) => i.quantity)).toEqual([4, 4]);
  });

  it("o aviso é só da segunda linha: 'resta 1' dela, nada da primeira", async () => {
    const itens = [linhaDeCarrinho("P", 4), linhaDeCarrinho("M", 4)];
    const catalogo = montarCatalogo(["a"], [produtoDoBanco], variacoes);

    const frases = await avisosDoCarrinho(itens, catalogo);

    expect(frases).toHaveLength(1);
    expect(frases[0]).toContain('"Camiseta (Cor: Azul, Tamanho: M)"');
    expect(frases[0]).toContain("1 unidade ");
  });
});
