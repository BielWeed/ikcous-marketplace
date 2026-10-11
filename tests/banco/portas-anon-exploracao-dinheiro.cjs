"use strict";

/**
 * A5a — O QUE UM ESTRANHO FAZ COM AS PORTAS DO DINHEIRO (auditoria de pagamento
 * e segurança, 10/10/2026). MEDIÇÃO, não portão: sempre sai 0 e imprime, no log
 * do rpc-ci, uma linha `PORTA <função> -> escreveu|vazou|recusou|executou|
 * inconclusivo|AUSENTE <detalhe>` por caso. O motor (e o que cada veredito
 * significa) está em portas-anon-exploracao-comum.cjs.
 *
 * Cada função abaixo é chamada, no banco efêmero e dentro de uma transação
 * desfeita, como o visitante sem login (`anon`) com o EXECUTE reaberto de
 * propósito (`GRANT EXECUTE ... TO anon`: a porta de um banco restaurado sem as
 * permissões). Cobre: create_marketplace_order v1/v22/v23 (e a v24, a que o
 * checkout chama hoje) — incluindo "o preço vem do cliente?" —, concluir_estorno,
 * liberar_cobranca_do_pedido, pagamentos_a_reconciliar ENCADEADO com a anterior,
 * solicitar_estorno, update_order_status_atomic, registrar_venda_presencial e uma
 * fin_* de escrita. Vira teste de regressão da B2 (a correção): lá o esperado
 * muda de "escreveu/vazou" para "recusou".
 *
 * USO (no rpc-ci.yml, depois das migrations):
 *   node tests/banco/rodar-isolado.cjs tests/banco/portas-anon-exploracao-dinheiro.cjs
 */

const {
  P_PRODUTO,
  chamar,
  como,
  novoId,
  pedidoSintetico,
  rodar,
  umaLinha,
} = require("./portas-anon-exploracao-comum.cjs");

const GATEWAY_ID = "PIX-SINTETICO-DINHEIRO-1";

// ---- Pedido pela porta do checkout (as quatro versões da create_marketplace_order) ----
const ITENS_BASE = { product_id: P_PRODUTO, variant_id: null, quantity: 1 };
const ENDERECO = JSON.stringify({
  cep: "38500-000",
  rua: "Rua Sintetica",
  numero: "1",
});

// O subtotal verdadeiro é 50 (preço do banco); o frete é 0 (free_shipping_min 0,01).
const itensComPreco = (preco) =>
  JSON.stringify([{ ...ITENS_BASE, price: preco, preco_unitario: preco }]);

/** v23/v24: 13 parâmetros (a v22 repassa 10 à v23 sem opção de entrega). */
const SQL_V23_V24 = (v) =>
  `SELECT public.create_marketplace_order_${v}(
     $1::jsonb, $2::numeric, $3::numeric, $4::text, $5::uuid, $6::text, $7::text,
     $8::text, $9::text, $10::jsonb, $11::text, $12::text, $13::uuid) AS id`;
const paramsV23V24 = (itens, total) => [
  itens,
  total,
  0,
  "pix",
  null,
  null,
  "Cliente Sintetico",
  "5539000000000",
  null,
  ENDERECO,
  "38500-000",
  "local-delivery",
  null,
];
const SQL_V22 = `SELECT public.create_marketplace_order_v22(
     $1::jsonb, $2::numeric, $3::numeric, $4::text, $5::uuid, $6::text, $7::text,
     $8::text, $9::text, $10::jsonb) AS id`;
const paramsV22 = (itens, total) => [
  itens,
  total,
  0,
  "pix",
  null,
  null,
  "Cliente Sintetico",
  "5539000000000",
  null,
  ENDERECO,
];
const SQL_V1 = `SELECT public.create_marketplace_order(
     $1::jsonb, $2::text, $3::uuid, $4::text, $5::text, $6::text, $7::text) AS id`;
const paramsV1 = (itens) => [
  itens,
  "pix",
  null,
  null,
  "Cliente Sintetico",
  "5539000000000",
  null,
];

/** Quantos pedidos existem e a que preço cada item foi GRAVADO (o do banco, ou o do cliente?). */
const observarPedidos = async (c) => {
  const r = await umaLinha(
    c,
    `SELECT (SELECT count(*) FROM public.marketplace_orders) AS pedidos,
            COALESCE((SELECT string_agg(DISTINCT price::text, ',')
                        FROM public.marketplace_order_items
                       WHERE product_name <> 'Item Sintetico'), '-') AS preco_gravado`,
  );
  return `pedidos=${r.pedidos} preco_gravado_no_item=${r.preco_gravado}`;
};

const casoPedido = ({ porta, assinatura, sql, params, quemControle }) => ({
  porta,
  assinatura,
  preparar: async () => ({}),
  controle: chamar(quemControle, sql, () => params.honesto),
  ataque: chamar("anon", sql, () => params.ataque),
  observar: observarPedidos,
});

const CASOS = [
  // --- create_marketplace_order, as quatro versões ---------------------------
  casoPedido({
    porta: "create_marketplace_order v1 (legada, exige sessão)",
    assinatura:
      "public.create_marketplace_order(jsonb,text,uuid,text,text,text,text)",
    sql: SQL_V1,
    quemControle: "donoCliente",
    params: {
      honesto: paramsV1(itensComPreco(50)),
      ataque: paramsV1(itensComPreco(0.01)),
    },
  }),
  casoPedido({
    porta: "create_marketplace_order_v22 (repassa à v23 sem opção de entrega)",
    assinatura:
      "public.create_marketplace_order_v22(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb)",
    sql: SQL_V22,
    quemControle: "donoCliente",
    params: {
      honesto: paramsV22(itensComPreco(50), 50),
      ataque: paramsV22(itensComPreco(0.01), 0.01),
    },
  }),
  ...["v23", "v24"].flatMap((v) => {
    const assinatura = `public.create_marketplace_order_${v}(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)`;
    return [
      casoPedido({
        porta: `create_marketplace_order_${v} (porta legítima do convidado): preço FORJADO no item (0,01), total honesto (50)`,
        assinatura,
        sql: SQL_V23_V24(v),
        quemControle: "cliente",
        params: {
          honesto: paramsV23V24(itensComPreco(50), 50),
          ataque: paramsV23V24(itensComPreco(0.01), 50),
        },
      }),
      casoPedido({
        porta: `create_marketplace_order_${v} (porta legítima do convidado): preço E total forjados (0,01)`,
        assinatura,
        sql: SQL_V23_V24(v),
        quemControle: "cliente",
        params: {
          honesto: paramsV23V24(itensComPreco(50), 50),
          ataque: paramsV23V24(itensComPreco(0.01), 0.01),
        },
      }),
    ];
  }),

  // --- estorno e cobrança -----------------------------------------------------
  {
    porta: "concluir_estorno",
    assinatura: "public.concluir_estorno(uuid,text,text,text)",
    preparar: async (c) => {
      const p = await pedidoSintetico(c, {
        status: "cancelled",
        paymentStatus: "pago",
        pago: true,
        total: 100,
      });
      const r = await umaLinha(
        c,
        `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status)
         VALUES ($1, 40, 'lojista', 'em_processamento') RETURNING id`,
        [p.id],
      );
      return { orderId: p.id, refundId: r.id };
    },
    controle: chamar(
      "service",
      "SELECT public.concluir_estorno($1::uuid, 'mp-refund-sintetico', 'approved', NULL) AS r",
      (ctx) => [ctx.refundId],
    ),
    ataque: chamar(
      "anon",
      "SELECT public.concluir_estorno($1::uuid, 'mp-refund-sintetico', 'approved', NULL) AS r",
      (ctx) => [ctx.refundId],
    ),
    observar: async (c, ctx) => {
      const r = await umaLinha(
        c,
        `SELECT o.valor_estornado, o.payment_status, f.status AS linha
           FROM public.marketplace_orders o JOIN public.order_refunds f ON f.order_id = o.id
          WHERE o.id = $1`,
        [ctx.orderId],
      );
      return `valor_estornado=${r.valor_estornado} payment_status=${r.payment_status} linha_do_estorno=${r.linha}`;
    },
  },
  {
    porta: "liberar_cobranca_do_pedido",
    assinatura: "public.liberar_cobranca_do_pedido(uuid,text)",
    preparar: async (c) => {
      const p = await pedidoSintetico(c, {
        status: "pending",
        paymentStatus: "aguardando",
        gateway: GATEWAY_ID,
        metodoOnline: "pix",
      });
      return { orderId: p.id };
    },
    controle: chamar(
      "service",
      "SELECT public.liberar_cobranca_do_pedido($1::uuid, $2) AS r",
      (ctx) => [ctx.orderId, GATEWAY_ID],
    ),
    ataque: chamar(
      "anon",
      "SELECT public.liberar_cobranca_do_pedido($1::uuid, $2) AS r",
      (ctx) => [ctx.orderId, GATEWAY_ID],
    ),
    observar: async (c, ctx) => {
      const r = await umaLinha(
        c,
        "SELECT gateway_payment_id, tentativas_de_pagamento FROM public.marketplace_orders WHERE id = $1",
        [ctx.orderId],
      );
      return `cobranca_na_vaga=${r.gateway_payment_id ?? "(solta)"} tentativas=${r.tentativas_de_pagamento}`;
    },
  },
  {
    // O encadeamento do plano: a lista da reconciliação entrega a cada estranho
    // o par (pedido, cobrança) de todo pedido com cobrança aberta; o par é
    // exatamente o que a `liberar_cobranca_do_pedido` pede para soltar a cobrança.
    porta:
      "pagamentos_a_reconciliar -> liberar_cobranca_do_pedido (encadeado, só com o que a 1ª devolveu)",
    assinatura: "public.pagamentos_a_reconciliar()",
    tambemAbre: ["public.liberar_cobranca_do_pedido(uuid,text)"],
    preparar: async (c) => {
      const p = await pedidoSintetico(c, {
        status: "pending",
        paymentStatus: "aguardando",
        gateway: GATEWAY_ID,
        metodoOnline: "pix",
      });
      return { orderId: p.id };
    },
    controle: chamar(
      "service",
      "SELECT * FROM public.pagamentos_a_reconciliar()",
    ),
    marcadores: () => [GATEWAY_ID],
    ataque: async (c) => {
      const lista = await como(
        c,
        "anon",
        "SELECT * FROM public.pagamentos_a_reconciliar()",
      );
      if (!lista.ok) return lista;
      // O estranho usa SÓ o que a lista devolveu.
      const alvo = lista.dados[0];
      if (!alvo) return { ...lista, nota: "a lista veio vazia" };
      const solta = await como(
        c,
        "anon",
        "SELECT public.liberar_cobranca_do_pedido($1::uuid, $2) AS r",
        [alvo.order_id, alvo.gateway_payment_id],
      );
      return {
        ok: true,
        dados: lista.dados,
        rowCount: lista.rowCount,
        nota: `1ª devolveu ${lista.dados.length} par(es); 2ª (com o par devolvido) ${solta.ok ? `passou e devolveu ${JSON.stringify(solta.dados[0]?.r)}` : `recusou: ${solta.code} ${solta.message}`}`,
      };
    },
    observar: async (c, ctx) => {
      const r = await umaLinha(
        c,
        "SELECT gateway_payment_id FROM public.marketplace_orders WHERE id = $1",
        [ctx.orderId],
      );
      return `cobranca_na_vaga=${r.gateway_payment_id ?? "(solta)"}`;
    },
  },
  {
    porta: "solicitar_estorno",
    assinatura: "public.solicitar_estorno(uuid,numeric,text)",
    preparar: async (c) => {
      const p = await pedidoSintetico(c, {
        status: "cancelled",
        paymentStatus: "pago",
        pago: true,
        total: 100,
      });
      return { orderId: p.id };
    },
    controle: chamar(
      "admin",
      "SELECT public.solicitar_estorno($1::uuid, 10, 'sintetico') AS r",
      (ctx) => [ctx.orderId],
    ),
    ataque: chamar(
      "anon",
      "SELECT public.solicitar_estorno($1::uuid, 10, 'sintetico') AS r",
      (ctx) => [ctx.orderId],
    ),
    observar: async (c, ctx) => {
      const r = await umaLinha(
        c,
        "SELECT count(*) AS n FROM public.order_refunds WHERE order_id = $1",
        [ctx.orderId],
      );
      return `linhas_de_estorno=${r.n}`;
    },
  },
  {
    porta: "update_order_status_atomic (cancelar pedido pendente, sem sessão)",
    assinatura: "public.update_order_status_atomic(uuid,text,text,boolean)",
    preparar: async (c) => {
      const p = await pedidoSintetico(c, {
        status: "pending",
        paymentStatus: "aguardando",
      });
      return { orderId: p.id };
    },
    controle: chamar(
      "cliente",
      "SELECT public.update_order_status_atomic($1::uuid, 'cancelled', 'sintetico', false) AS r",
      (ctx) => [ctx.orderId],
    ),
    ataque: chamar(
      "anon",
      "SELECT public.update_order_status_atomic($1::uuid, 'cancelled', 'sintetico', false) AS r",
      (ctx) => [ctx.orderId],
    ),
    observar: async (c, ctx) => {
      const r = await umaLinha(
        c,
        "SELECT status, payment_status FROM public.marketplace_orders WHERE id = $1",
        [ctx.orderId],
      );
      return `status=${r.status} payment_status=${r.payment_status}`;
    },
  },
  {
    porta:
      "update_order_status_atomic (marcar pedido como entregue, sem sessão)",
    assinatura: "public.update_order_status_atomic(uuid,text,text,boolean)",
    preparar: async (c) => {
      const p = await pedidoSintetico(c, {
        status: "shipping",
        paymentStatus: "pago",
        pago: true,
      });
      return { orderId: p.id };
    },
    controle: chamar(
      "admin",
      "SELECT public.update_order_status_atomic($1::uuid, 'delivered', 'sintetico', true) AS r",
      (ctx) => [ctx.orderId],
    ),
    ataque: chamar(
      "anon",
      "SELECT public.update_order_status_atomic($1::uuid, 'delivered', 'sintetico', true) AS r",
      (ctx) => [ctx.orderId],
    ),
    observar: async (c, ctx) => {
      const r = await umaLinha(
        c,
        "SELECT status FROM public.marketplace_orders WHERE id = $1",
        [ctx.orderId],
      );
      return `status=${r.status}`;
    },
  },
  {
    porta: "registrar_venda_presencial (venda de balcão sem sessão)",
    assinatura:
      "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)",
    preparar: async () => ({ chave: novoId("a5dddddd") }),
    controle: chamar(
      "admin",
      "SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL, 'Cliente Sintetico', NULL, 0, 'sintetico', $2::uuid) AS r",
      (ctx) => [
        JSON.stringify([
          { product_id: P_PRODUTO, variant_id: null, quantity: 1 },
        ]),
        ctx.chave,
      ],
    ),
    ataque: chamar(
      "anon",
      "SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL, 'Cliente Sintetico', NULL, 0, 'sintetico', $2::uuid) AS r",
      (ctx) => [
        JSON.stringify([
          { product_id: P_PRODUTO, variant_id: null, quantity: 1 },
        ]),
        ctx.chave,
      ],
    ),
    observar: async (c) => {
      const r = await umaLinha(
        c,
        `SELECT (SELECT count(*) FROM public.marketplace_orders WHERE canal = 'presencial') AS vendas,
                (SELECT estoque FROM public.produtos WHERE id = $1) AS estoque`,
        [P_PRODUTO],
      );
      return `vendas_de_balcao=${r.vendas} estoque_do_produto=${r.estoque}`;
    },
  },
  {
    porta: "fin_lancamento_salvar (lançamento financeiro sem sessão)",
    assinatura: "public.fin_lancamento_salvar(jsonb)",
    preparar: async (c) => {
      const conta = await umaLinha(
        c,
        "SELECT id FROM public.fin_contas WHERE ativa ORDER BY created_at LIMIT 1",
      );
      const categoria = await umaLinha(
        c,
        "SELECT id FROM public.fin_categorias WHERE ativa AND natureza = 'despesa' ORDER BY created_at LIMIT 1",
      );
      return {
        conta: conta ? conta.id : null,
        categoria: categoria ? categoria.id : null,
      };
    },
    controle: chamar(
      "admin",
      "SELECT public.fin_lancamento_salvar($1::jsonb) AS r",
      (ctx) => [
        JSON.stringify({
          tipo: "saida",
          valor: 10,
          descricao: "lancamento sintetico",
          conta_id: ctx.conta,
          categoria_id: ctx.categoria,
          status: "realizado",
        }),
      ],
    ),
    ataque: chamar(
      "anon",
      "SELECT public.fin_lancamento_salvar($1::jsonb) AS r",
      (ctx) => [
        JSON.stringify({
          tipo: "saida",
          valor: 10,
          descricao: "lancamento sintetico",
          conta_id: ctx.conta,
          categoria_id: ctx.categoria,
          status: "realizado",
        }),
      ],
    ),
    observar: async (c) => {
      const r = await umaLinha(
        c,
        "SELECT count(*) AS n FROM public.fin_lancamentos",
      );
      return `lancamentos=${r.n}`;
    },
  },
];

rodar("dinheiro", CASOS).catch((erro) => {
  console.log(`[dinheiro] ERRO DA MEDIÇÃO: ${erro.message}`);
  process.exitCode = 0;
});
