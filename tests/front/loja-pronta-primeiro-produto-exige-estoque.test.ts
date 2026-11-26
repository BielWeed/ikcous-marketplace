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

  it("só produto inativo (mesmo com estoque): pendente, e não fala de estoque", () => {
    const passo = passoProduto([{ isActive: false, stock: 9 }]);
    expect(passo.estado).toBe("pendente");
    expect(passo.explicacaoPendente).not.toBe(
      "Seus produtos ativos estão sem estoque",
    );
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

// A loja de teste grátis nasce com produtos cadastrados por script, alguns
// OCULTOS (desativados) para a lojista conferir o preço. Com produto
// cadastrado e nenhum ativo, "Cadastrar um produto ativo" mandava cadastrar o
// que já existe: o passo diz quantos estão ocultos e manda ativar.
describe("Primeiro produto: cadastrados, mas todos ocultos", () => {
  it("um oculto: singular, e manda conferir e ativar", () => {
    const passo = passoProduto([{ isActive: false, stock: 9 }]);
    expect(passo.estado).toBe("pendente");
    expect(passo.rotuloPendente).toBe("Conferir e ativar o produto oculto");
    expect(passo.explicacaoPendente).toBe(
      "Você tem 1 produto oculto. Confira o preço e toque em Ativar.",
    );
  });

  it("três ocultos: plural, com a contagem", () => {
    const passo = passoProduto([
      { isActive: false, stock: 9 },
      { isActive: false, stock: 0 },
      { isActive: false, stock: 2 },
    ]);
    expect(passo.estado).toBe("pendente");
    expect(passo.rotuloPendente).toBe("Conferir e ativar os produtos ocultos");
    expect(passo.explicacaoPendente).toBe(
      "Você tem 3 produtos ocultos. Confira o preço e toque em Ativar.",
    );
  });

  it("nenhum produto: segue pedindo para cadastrar", () => {
    expect(passoProduto([]).rotuloPendente).toBe("Cadastrar um produto ativo");
  });

  it("oculto + ativo esgotado: a pendência é o estoque, não os ocultos", () => {
    const passo = passoProduto([
      { isActive: false, stock: 9 },
      { isActive: true, stock: 0 },
    ]);
    expect(passo.rotuloPendente).toBe("Repor o estoque de um produto");
    expect(passo.explicacaoPendente).toBe(
      "Seus produtos ativos estão sem estoque",
    );
  });

  it("oculto + ativo à venda: feito", () => {
    expect(
      passoProduto([
        { isActive: false, stock: 9 },
        { isActive: true, stock: 3 },
      ]).estado,
    ).toBe("feito");
  });
});
