// O aviso "o cliente cancelou" some quando a lojista JA fez o que ele pede
// (08/11/2026).
//
// Defeito medido: o aviso nasce do historico do pedido e fica 24 h na tela. A
// regra so olhava o que o pedido era NA HORA do cancelamento: depois que a
// lojista tocava em "O produto voltou", ou depois que o dinheiro era devolvido
// (`payment_status` = estornado), o aviso seguia mandando "tocar em O produto
// voltou" / "avise o transporte" / "o reembolso e automatico" por ate 24 h.
//
// Os dois dados ja vem na MESMA consulta do hook (o pedido embutido na linha do
// historico): `payment_status` e `returned_to_seller_at`. Nao ha consulta nova.
//
// A regra:
//   - produto que SAIU (ja_saiu / retirada_pronta): o que a lojista faz e o
//     retorno do produto. `returned_to_seller_at` preenchido = feito, some.
//   - produto que NAO saiu (reembolso_automatico): o que resta e o dinheiro
//     voltar. `estornado` = feito, some.
//   - controles: nada feito = o aviso fica; produto que saiu e foi estornado
//     mas ainda nao voltou = o retorno ainda falta, fica.
import { describe, expect, it } from "vitest";

import {
  type EntradaDeAvisos,
  type LinhaDeCancelamento,
  montarAvisos,
  selecionarCancelamentosDoCliente,
} from "@/utils/avisos-do-lojista";

const CLIENTE = "c1111111-1111-4111-8111-111111111111";
const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const VOLTOU_EM = "2026-11-08T10:00:00.000Z";

const VAZIO: EntradaDeAvisos = {
  pedidos: [],
  perguntasPendentes: 0,
  avaliacoes: [],
  produtos: [],
};

function linha(
  extra: Partial<LinhaDeCancelamento> = {},
  pedido: Record<string, unknown> = {},
): LinhaDeCancelamento {
  return {
    id: "h1",
    order_id: PEDIDO,
    old_status: "shipping",
    created_by: CLIENTE,
    created_at: "2026-11-08T09:00:00.000Z",
    marketplace_orders: {
      id: PEDIDO,
      user_id: CLIENTE,
      customer_name: "Maria Silva",
      total: 149.9,
      payment_status: "pago",
      status: "cancelled",
      cancelled_after_shipping: true,
      ...pedido,
    },
    ...extra,
  };
}

const selecionar = (l: LinhaDeCancelamento) =>
  selecionarCancelamentosDoCliente([l], new Set());

describe("aviso de cancelamento — a lojista ja fez o que ele pedia", () => {
  it("retirada pronta cancelada: depois de 'O produto voltou' o aviso some", () => {
    const pedido = { pickup_address: "Rua da Loja, 10" };
    expect(selecionar(linha({}, pedido))[0]?.situacao).toBe("retirada_pronta");
    expect(
      selecionar(linha({}, { ...pedido, returned_to_seller_at: VOLTOU_EM })),
    ).toEqual([]);
  });

  it("entrega que ja saiu e cancelada: depois de 'O produto voltou' o aviso some", () => {
    expect(selecionar(linha())[0]?.situacao).toBe("ja_saiu");
    expect(selecionar(linha({}, { returned_to_seller_at: VOLTOU_EM }))).toEqual(
      [],
    );
  });

  it("pago e nao enviado: depois que o dinheiro foi devolvido (estornado) o aviso some", () => {
    const naoEnviado = { cancelled_after_shipping: false };
    const [pago] = selecionar(
      linha({ old_status: "processing" }, { ...naoEnviado }),
    );
    expect(pago?.situacao).toBe("reembolso_automatico");
    expect(
      selecionar(
        linha(
          { old_status: "processing" },
          { ...naoEnviado, payment_status: "estornado" },
        ),
      ),
    ).toEqual([]);
  });

  it("controle: produto que saiu, estornado mas que AINDA NAO voltou, continua no aviso", () => {
    const [c] = selecionar(linha({}, { payment_status: "estornado" }));
    expect(c?.situacao).toBe("ja_saiu");
  });

  it("controle: produto que saiu e AINDA NAO voltou continua (retorno nulo ou ausente)", () => {
    for (const returned_to_seller_at of [null, undefined]) {
      expect(
        selecionar(linha({}, { returned_to_seller_at })),
        String(returned_to_seller_at),
      ).toHaveLength(1);
    }
  });

  it("controle: pago depois do cancelamento (pago_apos_expirar) continua", () => {
    const [c] = selecionar(
      linha(
        { old_status: "processing" },
        {
          cancelled_after_shipping: false,
          payment_status: "pago_apos_expirar",
        },
      ),
    );
    expect(c?.situacao).toBe("pago_depois");
  });

  it("sem pagamento online e nao enviado: continua (o recado e nao separar nem enviar)", () => {
    const [c] = selecionar(
      linha(
        { old_status: "processing" },
        { cancelled_after_shipping: false, payment_status: null },
      ),
    );
    expect(c?.situacao).toBe("sem_pagamento_online");
  });

  it("de ponta a ponta: a lista do sino fica sem o aviso que ja foi resolvido", () => {
    const cancelamentosDoCliente = selecionarCancelamentosDoCliente(
      [
        linha({ id: "h-resolvido" }, { returned_to_seller_at: VOLTOU_EM }),
        linha({ id: "h-aberto", order_id: "outro-pedido" }, {}),
      ],
      new Set(),
    );
    const avisos = montarAvisos({ ...VAZIO, cancelamentosDoCliente });
    expect(avisos.map((a) => a.id)).toEqual(["cancelamento:h-aberto"]);
  });
});
