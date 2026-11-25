// Caça de mutação "só testes" (carrinho, 25/11/2026). Quatro mutantes de
// `escolhas-do-item.ts` e `catalogo-do-carrinho.ts` sobreviviam a toda a suíte
// que cita esses módulos. O que cada teste abaixo protege, em linguagem de loja:
//
//  - TRÊS linhas do mesmo produto dividindo a mesma variação (Azul-P, Azul-M e
//    Azul-G com 5 azuis): o desconto tem de SOMAR o que as linhas anteriores
//    levam, não guardar só o da última. Os testes que existiam usavam no
//    máximo duas linhas, e com duas linhas "somar" e "sobrescrever" dão o
//    mesmo número. Com a conta errada a terceira linha levava 2 de azul que
//    não existem, e o servidor recusa o pedido no fim.
//  - Segunda escolha que o produto já não tem (cor apagada pela lojista): conta
//    ZERO unidades. Inventar estoque para ela liberava o botão de mais numa
//    linha que o servidor vai recusar.
//  - Variação DESLIGADA pela lojista (existe, mas `active: false`): a linha que
//    a usa sai do carrinho, como a que sumiu. Só a variação apagada estava
//    coberta; a desligada seguia vendável no carrinho.
//  - Produto sem a lista de variações (cache antigo) e linha sem escolha: segue
//    vendável pelo estoque do produto, nunca é tirada do carrinho.
//  - Produto que entrou no carrinho enquanto a leitura do catálogo estava em
//    voo (o id nunca foi perguntado ao banco): não ganha o aviso "está
//    indisponível". Só aplicarCatalogoAoCarrinho tinha essa trava testada; o
//    texto dos avisos não.
import { describe, expect, it } from "vitest";

import {
  aplicarCatalogoAoCarrinho,
  avisosDoCarrinho,
  montarCatalogo,
} from "@/lib/catalogo-do-carrinho";
import {
  estoqueDaLinha,
  somarUso,
  usoPorVariante,
} from "@/lib/escolhas-do-item";
import { mapProductFromDB } from "@/lib/mappers";
import type { CartItem, Product } from "@/types";

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

const variacaoDoBanco = (
  id: string,
  nome: string,
  valor: string,
  estoque: number,
  active = true,
): Linha => ({
  id,
  product_id: "a",
  name: nome,
  value: valor,
  stock_increment: estoque,
  price_override: null,
  active,
});

// O azul tem 5 no estoque; P, M e G têm 10 cada.
const variacoes = [
  variacaoDoBanco("AZUL", "Cor", "Azul", 5),
  variacaoDoBanco("P", "Tamanho", "P", 10),
  variacaoDoBanco("M", "Tamanho", "M", 10),
  variacaoDoBanco("G", "Tamanho", "G", 10),
];

const produtoComVariacoes = (linhas: Linha[]): Product =>
  mapProductFromDB({ ...produtoDoBanco, product_variants: linhas });

const linhaAzul = (
  tamanho: "P" | "M" | "G",
  quantity: number,
  produto: Product = produtoComVariacoes(variacoes),
): CartItem => ({
  product: produto,
  quantity,
  variantId: "AZUL",
  outrasVariantIds: [tamanho],
  variantNames: `Cor: Azul, Tamanho: ${tamanho}`,
  lastModifiedAt: 1000,
});

describe("três linhas dividindo a mesma variação somam o que cada uma leva", () => {
  const tresLinhas = () => [
    linhaAzul("P", 2),
    linhaAzul("M", 2),
    linhaAzul("G", 2),
  ];

  it("usoPorVariante: o azul é usado 6 vezes (2+2+2) e cada tamanho 2", () => {
    const uso = usoPorVariante(tresLinhas());

    expect(uso.get("AZUL")).toBe(6);
    expect(uso.get("P")).toBe(2);
    expect(uso.get("M")).toBe(2);
    expect(uso.get("G")).toBe(2);
  });

  it("somarUso chamado três vezes na mesma variação acumula 2+3+4 = 9", () => {
    const uso = new Map<string, number>();

    somarUso(uso, { variantId: "a" }, 2);
    somarUso(uso, { variantId: "a" }, 3);
    somarUso(uso, { variantId: "a" }, 4);

    expect(uso.get("a")).toBe(9);
  });

  it("estoqueDaLinha: uma quarta linha vê o azul menos o que as três outras levam (10 - 6 = 4)", () => {
    const produto = produtoComVariacoes([
      variacaoDoBanco("AZUL", "Cor", "Azul", 10),
      variacaoDoBanco("P", "Tamanho", "P", 50),
      variacaoDoBanco("M", "Tamanho", "M", 50),
      variacaoDoBanco("G", "Tamanho", "G", 50),
      variacaoDoBanco("GG", "Tamanho", "GG", 50),
    ]);
    const outras = [
      linhaAzul("P", 2, produto),
      linhaAzul("M", 2, produto),
      linhaAzul("G", 2, produto),
    ];

    expect(estoqueDaLinha(produto, "AZUL", ["GG"], outras)).toBe(4);
  });

  it("o carrinho relendo o catálogo: com 5 azuis, a terceira linha desce de 2 para 1", () => {
    const catalogo = montarCatalogo(["a"], [produtoDoBanco], variacoes);

    const r = aplicarCatalogoAoCarrinho(tresLinhas(), catalogo, 5000);

    expect(r.map((i) => [i.outrasVariantIds?.[0], i.quantity])).toEqual([
      ["P", 2],
      ["M", 2],
      ["G", 1],
    ]);
    // Só a linha que desceu ganha o carimbo novo.
    expect(r.map((i) => i.lastModifiedAt)).toEqual([1000, 1000, 5000]);
  });

  it("controle: com 6 azuis as três linhas cabem e a lista volta a MESMA referência", () => {
    const comSeis = [
      variacaoDoBanco("AZUL", "Cor", "Azul", 6),
      variacaoDoBanco("P", "Tamanho", "P", 10),
      variacaoDoBanco("M", "Tamanho", "M", 10),
      variacaoDoBanco("G", "Tamanho", "G", 10),
    ];
    const produto = produtoComVariacoes(comSeis);
    const itens = [
      linhaAzul("P", 2, produto),
      linhaAzul("M", 2, produto),
      linhaAzul("G", 2, produto),
    ];
    const catalogo = montarCatalogo(["a"], [produtoDoBanco], comSeis);

    expect(aplicarCatalogoAoCarrinho(itens, catalogo, 5000)).toBe(itens);
  });
});

describe("segunda escolha que o produto já não tem conta zero unidades", () => {
  it("estoqueDaLinha: azul tem 5, mas a escolha 'FANTASMA' não existe mais: 0", () => {
    const produto = produtoComVariacoes([
      variacaoDoBanco("AZUL", "Cor", "Azul", 5),
    ]);

    expect(estoqueDaLinha(produto, "AZUL", ["FANTASMA"], [])).toBe(0);
  });

  it("controle: com a segunda escolha existindo (estoque 8) vale o menor dos dois", () => {
    const produto = produtoComVariacoes([
      variacaoDoBanco("AZUL", "Cor", "Azul", 5),
      variacaoDoBanco("P", "Tamanho", "P", 8),
    ]);

    expect(estoqueDaLinha(produto, "AZUL", ["P"], [])).toBe(5);
  });
});

describe("variação desligada pela lojista tira a linha do carrinho", () => {
  it("a escolha principal desligada (existe, mas active=false): a linha sai", () => {
    const noBanco = [
      variacaoDoBanco("PP", "Tamanho", "PP", 10, false),
      variacaoDoBanco("G", "Tamanho", "G", 5),
    ];
    const produtoQueACompradoraViu = produtoComVariacoes([
      variacaoDoBanco("PP", "Tamanho", "PP", 10),
      variacaoDoBanco("G", "Tamanho", "G", 5),
    ]);
    const itens: CartItem[] = [
      {
        product: produtoQueACompradoraViu,
        quantity: 1,
        variantId: "PP",
        variantNames: "Tamanho: PP",
        lastModifiedAt: 1000,
      },
    ];
    const catalogo = montarCatalogo(["a"], [produtoDoBanco], noBanco);

    expect(aplicarCatalogoAoCarrinho(itens, catalogo, 5000)).toEqual([]);
  });

  it("a SEGUNDA escolha desligada: a linha inteira sai (levar 'Azul P' precisa das duas)", () => {
    const noBanco = [
      variacaoDoBanco("AZUL", "Cor", "Azul", 5),
      variacaoDoBanco("P", "Tamanho", "P", 10, false),
    ];
    const itens = [linhaAzul("P", 1)];
    const catalogo = montarCatalogo(["a"], [produtoDoBanco], noBanco);

    expect(aplicarCatalogoAoCarrinho(itens, catalogo, 5000)).toEqual([]);
  });

  it("controle: as mesmas duas escolhas ligadas mantêm a linha", () => {
    const noBanco = [
      variacaoDoBanco("AZUL", "Cor", "Azul", 5),
      variacaoDoBanco("P", "Tamanho", "P", 10),
    ];
    const itens = [linhaAzul("P", 1, produtoComVariacoes(noBanco))];
    const catalogo = montarCatalogo(["a"], [produtoDoBanco], noBanco);

    const r = aplicarCatalogoAoCarrinho(itens, catalogo, 5000);

    expect(r.map((i) => i.quantity)).toEqual([1]);
  });
});

describe("produto do catálogo sem a lista de variações", () => {
  it("linha sem escolha segue vendável pelo estoque do produto (não é tirada nem cortada)", () => {
    // Cache antigo: o campo `variants` nem existe no produto.
    const { variants: _naoExiste, ...semLista }: Product = {
      ...produtoComVariacoes([]),
      stock: 7,
    };
    const itens: CartItem[] = [
      { product: semLista, quantity: 3, lastModifiedAt: 1000 },
    ];
    const catalogo = {
      consultados: new Set(["a"]),
      produtos: new Map([["a", semLista]]),
    };

    const r = aplicarCatalogoAoCarrinho(itens, catalogo, 5000);

    expect(r.map((i) => i.quantity)).toEqual([3]);
  });
});

describe("aviso do carrinho só fala do que foi perguntado ao banco", () => {
  it("produto fora de `consultados` não vira 'indisponível' (a leitura nem passou por ele)", async () => {
    const catalogo = montarCatalogo(["outro-produto"], [], []);

    const frases = await avisosDoCarrinho([linhaAzul("P", 1)], catalogo);

    expect(frases).toEqual([]);
  });

  it("controle: o mesmo produto, perguntado e que não voltou, avisa que está indisponível", async () => {
    const catalogo = montarCatalogo(["a"], [], []);

    const frases = await avisosDoCarrinho([linhaAzul("P", 1)], catalogo);

    expect(frases).toHaveLength(1);
    expect(frases[0]).toContain("indisponível");
  });
});
