// O passo "Primeiro produto" da lista "sua loja está pronta para vender?" só
// vale com produto ativo E com como ser comprado. Antes ele olhava só
// `isActive`: a lojista com o ÚNICO produto ativo esgotado via "Loja pronta"
// e nenhuma cliente conseguia comprar. A régua de "tem como comprar" é a da
// vitrine (`produtoDisponivel`), não uma cópia.
import {
  entradaDosSeisPassos,
  seisPassosDaLojaPronta,
} from "@/lib/loja-pronta";
import { describe, expect, it } from "vitest";

type Fatos = Parameters<typeof entradaDosSeisPassos>[1];

function passoProduto(produtos: Fatos["produtos"]) {
  const passos = seisPassosDaLojaPronta(
    entradaDosSeisPassos(
      {},
      {
        pixOk: true,
        formasNaEntrega: [],
        produtos,
        configCarregando: false,
        produtosCarregando: false,
        entrega: "feito",
      },
    ),
  );
  const achado = passos.find((passo) => passo.chave === "produto");
  if (!achado) throw new Error("passo produto não existe");
  return achado;
}

const opcao = (name: string, stockIncrement: number) => ({
  name,
  active: true,
  stockIncrement,
});

describe("Primeiro produto: produto ativo precisa ter como ser comprado", () => {
  it("ativo com estoque: feito", () => {
    expect(passoProduto([{ isActive: true, stock: 3 }]).estado).toBe("feito");
  });

  it("ativo com estoque 0 e sem variações: pendente, e diz que falta estoque", () => {
    const passo = passoProduto([{ isActive: true, stock: 0, variants: [] }]);
    expect(passo.estado).toBe("pendente");
    expect(passo.explicacaoPendente).toBe(
      "Seus produtos ativos estão sem estoque",
    );
  });

  it("ativo esgotado + outro ativo com estoque: feito", () => {
    expect(
      passoProduto([
        { isActive: true, stock: 0 },
        { isActive: true, stock: 2 },
      ]).estado,
    ).toBe("feito");
  });

  it("ativo cujas variações estão todas sem estoque: pendente", () => {
    // A soma `stock` positiva é falsa: nenhuma escolha de Cor tem estoque.
    expect(
      passoProduto([
        {
          isActive: true,
          stock: 8,
          variants: [opcao("Cor", 0), opcao("Cor", 0)],
        },
      ]).estado,
    ).toBe("pendente");
  });

  it("ativo com UMA variação com estoque em cada grupo: feito", () => {
    expect(
      passoProduto([
        {
          isActive: true,
          stock: 0,
          variants: [opcao("Cor", 0), opcao("Cor", 4)],
        },
      ]).estado,
    ).toBe("feito");
  });

  it("nenhum produto: pendente, sem a explicação de estoque", () => {
    const passo = passoProduto([]);
    expect(passo.estado).toBe("pendente");
    expect(passo.explicacaoPendente).toBeUndefined();
  });

  it("só produto inativo (mesmo com estoque): pendente, sem a explicação de estoque", () => {
    const passo = passoProduto([{ isActive: false, stock: 9 }]);
    expect(passo.estado).toBe("pendente");
    expect(passo.explicacaoPendente).toBeUndefined();
  });

  it("produto inativo com estoque não salva o ativo esgotado", () => {
    expect(
      passoProduto([
        { isActive: false, stock: 9 },
        { isActive: true, stock: 0 },
      ]).estado,
    ).toBe("pendente");
  });
});
