// Balcão: bipar o código de barras de UM TAMANHO/COR (origem "variante") põe no
// cupom o item COM o variantId da variação. É esse id que a função do banco do
// balcão exige para vender peça com variação; sem ele a venda é recusada
// ("Escolha uma variação para o produto ...") e o cupom, que mostra o nome da
// variação vindo de outra linha, parece certo. Nenhum teste conferia o
// variantId do item bipado: trocar `origem === "variante"` por `!==` nessa linha
// passava em toda a suíte.
//
// Pura, como `venda-presencial-maquina-de-estados.test.tsx`: roda em `node`, o
// relógio é um número passado à mão.
import { describe, expect, it } from "vitest";

import {
  type RespostaDoCodigo,
  chaveDoItemDoCupom,
  estadoInicialDaVenda,
  reducerDaVenda,
} from "@/hooks/useVendaPresencial";

const estadoBase = () => estadoInicialDaVenda(() => "chave-fixa-de-teste");

const respostaDaVariacaoM: RespostaDoCodigo = {
  encontrado: true,
  origem: "variante",
  codigo: "789000",
  produto: {
    id: "prod-vestido",
    nome: "Vestido",
    ativo: true,
    preco_venda: 100,
    estoque: 999, // não pode ser lido quando a origem é a variação
    imagem: "img-vestido.jpg",
    codigo_barras: null,
    tem_variantes: true,
  },
  variante: {
    variant_id: "var-m",
    nome: "Tamanho",
    valor: "M",
    preco: 90,
    estoque: 3,
    imagem: "img-vestido-m.jpg",
    codigo_barras: "789000",
  },
  preco: 90,
  estoque: 3,
  variacoes: [],
};

const respostaDeProdutoSemVariacao: RespostaDoCodigo = {
  encontrado: true,
  origem: "produto",
  codigo: "789111",
  produto: {
    id: "prod-caneca",
    nome: "Caneca",
    ativo: true,
    preco_venda: 29.9,
    estoque: 4,
    imagem: "img-caneca.jpg",
    codigo_barras: "789111",
    tem_variantes: false,
  },
  variante: null,
  preco: 29.9,
  estoque: 4,
  variacoes: [],
};

describe("bipe de código de UMA variação — o item do cupom leva o variantId dela", () => {
  it("o item entra com o variantId da variação bipada, o nome dela, o preço e a chave certos", () => {
    const estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "789000",
      resposta: respostaDaVariacaoM,
      em: 0,
    });

    expect(estado.aviso).toBeNull();
    expect(estado.itens).toHaveLength(1);
    const item = estado.itens[0];
    expect(item.variantId).toBe("var-m");
    expect(item.productId).toBe("prod-vestido");
    expect(item.chave).toBe(chaveDoItemDoCupom("prod-vestido", "var-m"));
    expect(item.variacao).toBe("Tamanho M");
    expect(item.preco).toBe(90);
    expect(item.estoque).toBe(3);
    expect(item.imagem).toBe("img-vestido-m.jpg");
  });

  it("controle: produto sem variação entra com variantId null (a regra não é 'sempre preenche')", () => {
    const estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "789111",
      resposta: respostaDeProdutoSemVariacao,
      em: 0,
    });

    expect(estado.itens).toHaveLength(1);
    expect(estado.itens[0].variantId).toBeNull();
    expect(estado.itens[0].variacao).toBeNull();
    expect(estado.itens[0].chave).toBe(chaveDoItemDoCupom("prod-caneca", null));
  });

  it("duas variações do mesmo produto viram dois itens, cada um com o seu variantId", () => {
    let estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "789000",
      resposta: respostaDaVariacaoM,
      em: 0,
    });
    estado = reducerDaVenda(estado, {
      tipo: "codigo_resolvido",
      codigo: "789001",
      resposta: {
        ...respostaDaVariacaoM,
        codigo: "789001",
        variante: {
          ...respostaDaVariacaoM.variante!,
          variant_id: "var-g",
          valor: "G",
          codigo_barras: "789001",
        },
      },
      em: 10_000,
    });

    expect(estado.itens.map((i) => i.variantId)).toEqual(["var-m", "var-g"]);
  });
});
