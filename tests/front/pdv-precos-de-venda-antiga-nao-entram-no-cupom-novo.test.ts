// Balcão: o banco recusa a venda quando o total conferido não bate e devolve os
// preços atuais (`precos_atualizados`). Essa resposta chega pela rede e pode
// chegar ATRASADA — depois de a lojista limpar o cupom e começar a venda
// seguinte. Ela é da venda ANTIGA (chave de idempotência antiga) e não pode
// mexer nos preços do cupom novo: o caixa cobraria da cliente seguinte o
// preço que o banco calculou para outra venda.
import { describe, expect, it } from "vitest";

import {
  type EstadoDaVenda,
  type ItemDoCupom,
  chaveDoItemDoCupom,
  estadoInicialDaVenda,
  reducerDaVenda,
  totalDaVenda,
} from "@/hooks/useVendaPresencial";

const CHAVE_ANTIGA = "chave-da-venda-antiga";
const CHAVE_NOVA = "chave-da-venda-nova";

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

const RESPOSTA_DA_VENDA_ANTIGA = [
  { product_id: "prod-caneca", variant_id: null, price: 99 },
];

/** A venda antiga em andamento (preço R$ 20) e, depois de "limpar cupom", a
 * venda nova com a MESMA caneca a R$ 30 — pelos mesmos caminhos do reducer. */
function vendaNovaDepoisDeLimparOCupom(): EstadoDaVenda {
  const antiga: EstadoDaVenda = {
    ...estadoInicialDaVenda(() => CHAVE_ANTIGA),
    itens: [item(20)],
    pagamento: "cash",
  };
  const limpo = reducerDaVenda(antiga, {
    tipo: "cupom_limpo",
    novaChave: CHAVE_NOVA,
  });
  const nova = reducerDaVenda(limpo, {
    tipo: "item_adicionado_manualmente",
    item: item(30),
    em: 1_000,
  });
  return reducerDaVenda(nova, {
    tipo: "pagamento_escolhido",
    pagamento: "pix",
  });
}

describe("precos_atualizados — só a resposta da venda em andamento vale", () => {
  it("resposta atrasada da venda ANTIGA, depois de cupom_limpo, não muda o preço do cupom novo", () => {
    const nova = vendaNovaDepoisDeLimparOCupom();
    // Ponto de partida: é mesmo outra venda, com outra chave e outro preço.
    expect(nova.chaveDeIdempotencia).toBe(CHAVE_NOVA);
    expect(nova.itens.map((i) => i.preco)).toEqual([30]);
    expect(totalDaVenda(nova)).toBe(30);

    const depois = reducerDaVenda(nova, {
      tipo: "precos_atualizados",
      chaveDeIdempotencia: CHAVE_ANTIGA,
      itens: RESPOSTA_DA_VENDA_ANTIGA,
    });

    expect(depois).toBe(nova);
    expect(depois.itens.map((i) => i.preco)).toEqual([30]);
    expect(totalDaVenda(depois)).toBe(30);
  });

  it("a chave antiga também não vale com o cupom novo ainda VAZIO (nada a repreçar)", () => {
    const antiga: EstadoDaVenda = {
      ...estadoInicialDaVenda(() => CHAVE_ANTIGA),
      itens: [item(20)],
    };
    const limpo = reducerDaVenda(antiga, {
      tipo: "cupom_limpo",
      novaChave: CHAVE_NOVA,
    });

    const depois = reducerDaVenda(limpo, {
      tipo: "precos_atualizados",
      chaveDeIdempotencia: CHAVE_ANTIGA,
      itens: RESPOSTA_DA_VENDA_ANTIGA,
    });

    expect(depois).toBe(limpo);
    expect(depois.itens).toEqual([]);
  });

  // O outro lado da borda: sem isto, "ignorar toda resposta" também passaria.
  it("a resposta com a chave da venda NOVA ainda é aceita e repreça o cupom", () => {
    const nova = vendaNovaDepoisDeLimparOCupom();

    const depois = reducerDaVenda(nova, {
      tipo: "precos_atualizados",
      chaveDeIdempotencia: CHAVE_NOVA,
      itens: [{ product_id: "prod-caneca", variant_id: null, price: 35 }],
    });

    expect(depois.itens.map((i) => i.preco)).toEqual([35]);
    expect(totalDaVenda(depois)).toBe(35);
    // Só preço muda: chave, pagamento e etapa ficam.
    expect(depois.chaveDeIdempotencia).toBe(CHAVE_NOVA);
    expect(depois.pagamento).toBe("pix");
    expect(depois.etapa).toBe(nova.etapa);
  });

  it("depois de cupom_refeito_com_a_tela a chave gira de novo: a resposta da chave anterior não repreça", () => {
    const antiga: EstadoDaVenda = {
      ...estadoInicialDaVenda(() => CHAVE_ANTIGA),
      itens: [item(20)],
      pagamento: "cash",
      etapa: "recibo",
      recibo: {
        orderId: "11111111-1111-1111-1111-111111111111",
        numero: "111111",
        criadoEm: "2026-11-24T12:00:00.000Z",
        total: 20,
        subtotal: 20,
        desconto: 0,
        pagamento: "cash",
        cliente: { tipo: "sem_cliente" },
        itens: [item(20, 1)],
        jaExistia: true,
        anulada: true,
        divergenciaComATela: {
          totalDaTela: 40,
          unidadesDaTela: 2,
          pagamentoDaTela: "cash",
        },
      },
    };
    const refeito = reducerDaVenda(antiga, {
      tipo: "cupom_refeito_com_a_tela",
      novaChave: CHAVE_NOVA,
    });
    expect(refeito.chaveDeIdempotencia).toBe(CHAVE_NOVA);

    const depois = reducerDaVenda(refeito, {
      tipo: "precos_atualizados",
      chaveDeIdempotencia: CHAVE_ANTIGA,
      itens: RESPOSTA_DA_VENDA_ANTIGA,
    });

    expect(depois).toBe(refeito);
    expect(depois.itens.map((i) => i.preco)).toEqual([20]);
  });
});
