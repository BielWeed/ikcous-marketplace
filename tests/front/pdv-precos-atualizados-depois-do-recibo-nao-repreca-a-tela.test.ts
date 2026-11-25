// Balcão: o banco recusa a venda quando o total conferido não bate e devolve os
// preços atuais (`precos_atualizados`). Depois que a venda JÁ virou recibo, uma
// resposta dessas — da MESMA chave de idempotência, por exemplo a de uma
// tentativa lenta que só chegou agora — não pode repreçar o cupom que ficou por
// baixo do recibo. Esse cupom é o que `cupom_refeito_com_a_tela` devolve à
// caixa para refazer a venda depois de uma anulação: com os preços trocados em
// silêncio, ela cobraria um valor que nunca viu na tela.
//
// Complementa tests/front/pdv-precos-de-venda-antiga-nao-entram-no-cupom-novo.test.ts
// (que cobre a chave DIFERENTE) com a guarda `estado.recibo`, que ficou sem
// teste: tirar só ela da condição não derrubava nenhum teste (mutação, 25/11/2026).
import { describe, expect, it } from "vitest";

import {
  type EstadoDaVenda,
  type ItemDoCupom,
  type ReciboDaVendaRegistrada,
  chaveDoItemDoCupom,
  estadoInicialDaVenda,
  reducerDaVenda,
  totalDaVenda,
} from "@/hooks/useVendaPresencial";

const CHAVE = "chave-da-venda-em-andamento";

function item(preco: number, quantidade = 1): ItemDoCupom {
  return {
    chave: chaveDoItemDoCupom("prod-caneca", null),
    productId: "prod-caneca",
    variantId: null,
    nome: "Caneca",
    variacao: null,
    preco,
    quantidade,
    estoque: 50,
    imagem: "",
  };
}

const PRECO_ATUAL_DO_BANCO = [
  { product_id: "prod-caneca", variant_id: null, price: 35 },
];

function reciboDe(
  parcial: Partial<ReciboDaVendaRegistrada> = {},
): ReciboDaVendaRegistrada {
  return {
    orderId: "11111111-1111-1111-1111-111111111111",
    numero: "111111",
    criadoEm: "2026-11-25T12:00:00.000Z",
    total: 40,
    subtotal: 40,
    desconto: 0,
    pagamento: "cash",
    cliente: { tipo: "sem_cliente" },
    itens: [item(20, 2)],
    jaExistia: false,
    ...parcial,
  };
}

/** Venda em andamento: 2 canecas a R$ 20, dinheiro, ainda sem recibo. */
function vendaEmAndamento(): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => CHAVE),
    etapa: "fechamento",
    itens: [item(20, 2)],
    pagamento: "cash",
    enviando: true,
  };
}

describe("precos_atualizados — com o recibo na tela, a resposta da MESMA chave não repreça", () => {
  it("controle: antes do recibo, a mesma resposta com a mesma chave repreça o cupom", () => {
    const antes = vendaEmAndamento();

    const depois = reducerDaVenda(antes, {
      tipo: "precos_atualizados",
      chaveDeIdempotencia: CHAVE,
      itens: PRECO_ATUAL_DO_BANCO,
    });

    expect(depois.itens.map((i) => i.preco)).toEqual([35]);
    expect(totalDaVenda(depois)).toBe(70);
  });

  it("depois de venda_registrada, a resposta com a mesma chave devolve o MESMO estado e o cupom segue a R$ 20", () => {
    const comRecibo = reducerDaVenda(vendaEmAndamento(), {
      tipo: "venda_registrada",
      recibo: reciboDe(),
    });
    // Ponto de partida: a chave é a mesma e o recibo está na tela.
    expect(comRecibo.chaveDeIdempotencia).toBe(CHAVE);
    expect(comRecibo.etapa).toBe("recibo");
    expect(comRecibo.recibo).not.toBeNull();

    const depois = reducerDaVenda(comRecibo, {
      tipo: "precos_atualizados",
      chaveDeIdempotencia: CHAVE,
      itens: PRECO_ATUAL_DO_BANCO,
    });

    // toBe: nem uma cópia nova do estado — nada mexeu.
    expect(depois).toBe(comRecibo);
    expect(depois.itens.map((i) => i.preco)).toEqual([20]);
    expect(totalDaVenda(depois)).toBe(40);
  });

  it("recibo de venda que já existia, divergente e ANULADA: a resposta tardia não muda o cupom que 'refazer com a tela' devolve", () => {
    const divergente = reducerDaVenda(vendaEmAndamento(), {
      tipo: "venda_registrada",
      recibo: reciboDe({
        jaExistia: true,
        total: 20,
        subtotal: 20,
        itens: [item(20, 1)],
      }),
    });
    expect(divergente.recibo?.divergenciaComATela).toBeDefined();
    const anulado = reducerDaVenda(divergente, {
      tipo: "recibo_anulado",
      orderId: "11111111-1111-1111-1111-111111111111",
    });
    expect(anulado.recibo?.anulada).toBe(true);

    const tardia = reducerDaVenda(anulado, {
      tipo: "precos_atualizados",
      chaveDeIdempotencia: CHAVE,
      itens: PRECO_ATUAL_DO_BANCO,
    });
    expect(tardia).toBe(anulado);

    const refeito = reducerDaVenda(tardia, {
      tipo: "cupom_refeito_com_a_tela",
      novaChave: "chave-da-venda-refeita",
    });
    // O cupom devolvido é o que a caixa viu: 2 × R$ 20, não 2 × R$ 35.
    expect(refeito.etapa).toBe("cupom");
    expect(refeito.itens.map((i) => i.preco)).toEqual([20]);
    expect(totalDaVenda(refeito)).toBe(40);
  });

  it("repetir a mesma resposta (antes do recibo) é idempotente: o segundo despacho não muda nada", () => {
    const acao = {
      tipo: "precos_atualizados" as const,
      chaveDeIdempotencia: CHAVE,
      itens: PRECO_ATUAL_DO_BANCO,
    };
    const uma = reducerDaVenda(vendaEmAndamento(), acao);
    const duas = reducerDaVenda(uma, acao);

    expect(duas).toEqual(uma);
    expect(duas.itens.map((i) => i.preco)).toEqual([35]);
  });
});
