// Balcão: quando a rede cai e a lojista tenta de novo, o banco pode devolver a
// venda ANTIGA (`ja_existia`). O reducer compara essa venda com o que a tela
// mostra e avisa se forem diferentes (o recibo fica vermelho, "anule esta
// venda"). A QUANTIDADE tem de entrar nessa comparação: com o mesmo produto,
// o mesmo total e a mesma forma de pagamento, duas peças na tela contra uma no
// banco é uma venda DIFERENTE — e sem o aviso o caixa entrega duas peças
// recebendo por uma.
import { describe, expect, it } from "vitest";

import {
  type EstadoDaVenda,
  type ItemDoCupom,
  type ReciboDaVendaRegistrada,
  chaveDoItemDoCupom,
  estadoInicialDaVenda,
  reducerDaVenda,
} from "@/hooks/useVendaPresencial";

function item(
  id: string,
  nome: string,
  quantidade: number,
  preco = 10,
): ItemDoCupom {
  return {
    chave: chaveDoItemDoCupom(id, null),
    productId: id,
    variantId: null,
    nome,
    variacao: null,
    preco,
    quantidade,
    estoque: 99,
    imagem: "",
  };
}

function reciboDoBanco(
  itens: readonly ItemDoCupom[],
  total: number,
  parcial: Partial<ReciboDaVendaRegistrada> = {},
): ReciboDaVendaRegistrada {
  return {
    orderId: "11111111-1111-1111-1111-111111111111",
    numero: "111111",
    criadoEm: "2026-11-24T12:00:00.000Z",
    total,
    subtotal: total,
    desconto: 0,
    pagamento: "cash",
    cliente: { tipo: "sem_cliente" },
    itens,
    jaExistia: true,
    ...parcial,
  };
}

/** A tela da caixa no meio do reenvio, com a chave que já tinha ido ao banco. */
function telaCom(
  itens: readonly ItemDoCupom[],
  desconto = 0,
  pagamento: EstadoDaVenda["pagamento"] = "cash",
): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => "chave-antiga"),
    itens,
    pagamento,
    desconto,
    motivoDoDesconto: desconto > 0 ? "cortesia" : "",
    enviando: true,
  };
}

function aposOReenvio(
  tela: EstadoDaVenda,
  recibo: ReciboDaVendaRegistrada,
): EstadoDaVenda {
  return reducerDaVenda(tela, { tipo: "venda_registrada", recibo });
}

describe("ja_existia — a quantidade conta na comparação com a tela", () => {
  // Mutação que este teste prende: tirar a quantidade da chave de comparação
  // dos itens. Aqui o total, o produto e o pagamento são IGUAIS — só a
  // quantidade difere (2 × R$ 10 com R$ 10 de desconto = R$ 10; 1 × R$ 10 = R$ 10).
  it("2 × R$ 10 com R$ 10 de desconto na tela contra 1 × R$ 10 no banco: divergência", () => {
    const tela = telaCom([item("p1", "Camiseta", 2)], 10);
    const banco = reciboDoBanco([item("p1", "Camiseta", 1)], 10);

    const depois = aposOReenvio(tela, banco);

    expect(depois.etapa).toBe("recibo");
    expect(depois.recibo?.jaExistia).toBe(true);
    expect(depois.recibo?.divergenciaComATela).toEqual({
      totalDaTela: 10,
      unidadesDaTela: 2,
      pagamentoDaTela: "cash",
      aMaisNaTela: [{ nome: "Camiseta", variacao: null, quantidade: 1 }],
    });
  });

  it("o inverso (1 na tela, 2 no banco) também diverge, apontando a peça a menos na tela", () => {
    const tela = telaCom([item("p1", "Camiseta", 1)]);
    const banco = reciboDoBanco([item("p1", "Camiseta", 2)], 10, {
      subtotal: 20,
      desconto: 10,
    });

    const depois = aposOReenvio(tela, banco);

    expect(depois.recibo?.divergenciaComATela).toEqual({
      totalDaTela: 10,
      unidadesDaTela: 1,
      pagamentoDaTela: "cash",
      aMenosNaTela: [{ nome: "Camiseta", variacao: null, quantidade: 1 }],
    });
  });

  it("troca de quantidades entre dois produtos, com o mesmo total: divergência", () => {
    const tela = telaCom([item("p1", "Camiseta", 2), item("p2", "Boné", 1)]);
    const banco = reciboDoBanco(
      [item("p1", "Camiseta", 1), item("p2", "Boné", 2)],
      30,
    );

    const depois = aposOReenvio(tela, banco);

    expect(depois.recibo?.divergenciaComATela).toMatchObject({
      totalDaTela: 30,
      unidadesDaTela: 3,
      aMaisNaTela: [{ nome: "Camiseta", variacao: null, quantidade: 1 }],
      aMenosNaTela: [{ nome: "Boné", variacao: null, quantidade: 1 }],
    });
  });

  // O outro lado da borda: sem isto, "sempre divergente" também passaria.
  it("mesma quantidade, mesmo total e mesmo pagamento: sem divergência", () => {
    const tela = telaCom([item("p1", "Camiseta", 2)], 10);
    const banco = reciboDoBanco([item("p1", "Camiseta", 2)], 10, {
      subtotal: 20,
      desconto: 10,
    });

    const depois = aposOReenvio(tela, banco);

    expect(depois.recibo?.jaExistia).toBe(true);
    expect(depois.recibo?.divergenciaComATela).toBeUndefined();
  });

  it("a ordem dos itens não cria divergência", () => {
    const tela = telaCom([item("p1", "Camiseta", 2), item("p2", "Boné", 1)]);
    const banco = reciboDoBanco(
      [item("p2", "Boné", 1), item("p1", "Camiseta", 2)],
      30,
    );

    expect(
      aposOReenvio(tela, banco).recibo?.divergenciaComATela,
    ).toBeUndefined();
  });

  it("forma de pagamento diferente continua sendo divergência (a regra irmã não regrediu)", () => {
    const tela = telaCom([item("p1", "Camiseta", 1)], 0, "pix");
    const banco = reciboDoBanco([item("p1", "Camiseta", 1)], 10, {
      pagamento: "cash",
    });

    expect(aposOReenvio(tela, banco).recibo?.divergenciaComATela).toMatchObject(
      { pagamentoDaTela: "pix", unidadesDaTela: 1 },
    );
  });

  it("venda nova (jaExistia false) nunca carrega divergência, mesmo com tela diferente", () => {
    const tela = telaCom([item("p1", "Camiseta", 2)]);
    const banco = reciboDoBanco([item("p1", "Camiseta", 1)], 10, {
      jaExistia: false,
    });

    const depois = aposOReenvio(tela, banco);

    expect(depois.recibo?.divergenciaComATela).toBeUndefined();
  });
});
