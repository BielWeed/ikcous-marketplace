"use strict";

/**
 * PROVA VIVA da migration 20261184000000_o_pix_do_balcao_abre_na_hora.sql
 * (frente A, docs/superpowers/plans/2026-09-28-balcao-pix-no-balcao.md) contra
 * o Postgres EFÊMERO com as migrations aplicadas do zero.
 *
 *   (a) porta: só admin; chave obrigatória; PIX pelo app desligado recusa;
 *       total zero não vira PIX.
 *   (b) a venda nasce À ESPERA do PIX: pending/aguardando/online/pix/presencial,
 *       estoque RESERVADO, preço do banco, 30 min, sem dinheiro recebido; nada
 *       no Financeiro nem no CRM enquanto espera.
 *   (c) idempotência: a mesma chave devolve o mesmo pedido sem segunda baixa;
 *       chave de venda em dinheiro, ou de outro balconista, é 23505.
 *   (d) pago pelo caminho de sempre (`confirmar_pagamento`) → o gatilho marca
 *       entregue + histórico; o Financeiro põe a entrada na conta MERCADO PAGO,
 *       forma pix, origem venda_balcao; o CRM conta a venda; a 2ª confirmação
 *       não duplica nada.
 *   (e) expira sem pagar → a varredura devolve o estoque; o pagamento tardio
 *       vira pago_apos_expirar e NÃO vira entregue.
 *   (f) cancelado pela loja antes de pagar → estoque de volta; pagamento
 *       tardio vira pago_apos_expirar, cancelado.
 *   (g) o gatilho não alcança pedido do SITE.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/pix-do-balcao-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const U_CLIENTE = "61111111-1111-1111-1111-111111111111";
const U_ADMIN = "62222222-2222-2222-2222-222222222222";
const U_ADMIN_2 = "63333333-3333-3333-3333-333333333333";
const P_SIMPLES = "6aaaaaaa-0000-0000-0000-000000000001";
const P_COM_VARIACAO = "6aaaaaaa-0000-0000-0000-000000000002";
const V_PP = "6bbbbbbb-0000-0000-0000-000000000001";
const MP = "f1000000-0000-4000-8000-000000000003";
const CHAVE = (n) => `6ccccccc-0000-4000-8000-00000000000${n}`;
const ORDER_SITE = "6ddddddd-0000-0000-0000-000000000001";

async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId,
  ]);
}
async function um(cliente, sql, params = []) {
  return (await cliente.query(sql, params)).rows[0];
}
const num = (v) => Math.round(Number(v) * 100) / 100;

async function estoque(cliente) {
  const p = await um(
    cliente,
    "SELECT estoque FROM public.produtos WHERE id = $1",
    [P_SIMPLES],
  );
  const v = await um(
    cliente,
    "SELECT stock_increment FROM public.product_variants WHERE id = $1",
    [V_PP],
  );
  return { simples: Number(p.estoque), pp: Number(v.stock_increment) };
}

function iniciar(cliente, itens, extras = {}) {
  return cliente
    .query(
      `SELECT public.iniciar_venda_presencial_pix(
          $1::jsonb, $2::uuid, $3::uuid, $4::text, $5::text, $6::numeric, $7::text
        ) AS venda`,
      [
        JSON.stringify(itens),
        extras.chave === undefined ? null : extras.chave,
        extras.clienteUserId || null,
        extras.clienteNome || null,
        extras.whatsapp || null,
        extras.desconto === undefined ? 0 : extras.desconto,
        extras.observacao === undefined ? null : extras.observacao,
      ],
    )
    .then((r) => r.rows[0].venda);
}

async function movimentosDoPedido(cliente, pedidoId) {
  return (
    await cliente.query(
      "SELECT origem, tipo, status, valor, conta_id, forma_pagamento, canal FROM public.fin__movimentos(NULL, NULL) WHERE pedido_id = $1",
      [pedidoId],
    )
  ).rows;
}

async function vendasDoCrm(cliente, pedidoId) {
  return (
    await cliente.query(
      "SELECT * FROM public.crm__vendas(now() + interval '1 day') v WHERE v.order_id = $1",
      [pedidoId],
    )
  ).rows;
}

async function historico(cliente, pedidoId) {
  return (
    await cliente.query(
      "SELECT old_status, new_status, notes FROM public.marketplace_order_history WHERE order_id = $1 ORDER BY created_at, id",
      [pedidoId],
    )
  ).rows;
}

async function confirmar(cliente, pedidoId, idCobranca) {
  return (
    await um(
      cliente,
      "SELECT public.confirmar_pagamento($1, $2, 'pago') AS r",
      [pedidoId, idCobranca],
    )
  ).r;
}

const PROVAS = [];
const estado = {};

PROVAS.push({
  nome: "(a) porta: só admin, chave obrigatória, PIX desligado recusa, total zero recusa",
  corpo: async (cliente) => {
    await cliente.query(
      `INSERT INTO public.store_config (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, pagamento_online)
       VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true)
       ON CONFLICT (id) DO UPDATE SET pagamento_online = true`,
    );
    for (const [id, meta] of [
      [U_CLIENTE, "{}"],
      [U_ADMIN, '{"role":"admin"}'],
      [U_ADMIN_2, '{"role":"admin"}'],
    ]) {
      await cliente.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@pix.teste', $2::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [id, meta],
      );
    }
    await cliente.query(
      `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
       VALUES ($1, 'Camiseta Balcão', 10.00, 25.00, 10, true, false),
              ($2, 'Vestido Balcão', 20.00, 99.00, 7, true, false)`,
      [P_SIMPLES, P_COM_VARIACAO],
    );
    await cliente.query(
      `INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, price_override, active)
       VALUES ($1, $2, 'Tamanho', 'PP', 5, 7.50, true)`,
      [V_PP, P_COM_VARIACAO],
    );

    await logar(cliente, U_CLIENTE);
    await assert.rejects(
      () =>
        iniciar(cliente, [{ product_id: P_SIMPLES, quantity: 1 }], {
          chave: CHAVE(9),
        }),
      /Acesso negado/,
      "cliente comum não abre PIX de balcão",
    );

    await logar(cliente, U_ADMIN);
    await assert.rejects(
      () => iniciar(cliente, [{ product_id: P_SIMPLES, quantity: 1 }]),
      /Falta a chave/,
      "sem chave não há retry seguro",
    );

    await cliente.query(
      "UPDATE public.store_config SET pagamento_online = false WHERE id = 1",
    );
    await assert.rejects(
      () =>
        iniciar(cliente, [{ product_id: P_SIMPLES, quantity: 1 }], {
          chave: CHAVE(9),
        }),
      /PIX pelo app está desligado/,
    );
    await cliente.query(
      "UPDATE public.store_config SET pagamento_online = true WHERE id = 1",
    );

    await assert.rejects(
      () =>
        iniciar(cliente, [{ product_id: P_SIMPLES, quantity: 1 }], {
          chave: CHAVE(9),
          desconto: 25,
          observacao: "brinde",
        }),
      /Um PIX precisa de valor maior que zero/,
    );
    assert.deepEqual(
      await estoque(cliente),
      { simples: 10, pp: 5 },
      "recusa não mexe em estoque",
    );
  },
});

PROVAS.push({
  nome: "(b) nasce à espera do PIX, com estoque reservado e nada no Financeiro/CRM",
  corpo: async (cliente) => {
    await logar(cliente, U_ADMIN);
    const venda = await iniciar(
      cliente,
      [
        { product_id: P_SIMPLES, variant_id: null, quantity: 2 },
        { product_id: P_COM_VARIACAO, variant_id: V_PP, quantity: 1 },
      ],
      {
        chave: CHAVE(1),
        desconto: 0.5,
        observacao: "arredondamento",
        clienteUserId: U_CLIENTE,
      },
    );
    assert.equal(venda.ja_existia, false);
    const o = venda.order;
    estado.pedido1 = o.id;
    assert.equal(o.canal, "presencial");
    assert.equal(o.status, "pending");
    assert.equal(o.payment_status, "aguardando");
    assert.equal(o.payment_method, "online");
    assert.equal(o.metodo_online, "pix");
    assert.equal(o.vendedor_id, U_ADMIN);
    assert.equal(o.user_id, U_CLIENTE);
    assert.equal(
      o.pagamento_recebido_em,
      null,
      "nenhum dinheiro recebido ainda",
    );
    assert.equal(o.gateway_payment_id, null, "a cobrança é da edge");
    assert.equal(num(o.subtotal), 57.5, "2 × 25,00 + 7,50 do banco");
    assert.equal(num(o.total), 57, "subtotal - desconto");
    const minutos = (new Date(o.expires_at).getTime() - Date.now()) / 60000;
    assert.ok(
      minutos > 28 && minutos <= 30.5,
      `reserva de 30 min (veio ${minutos})`,
    );
    assert.equal(venda.items.length, 2);
    assert.deepEqual(
      await estoque(cliente),
      { simples: 8, pp: 4 },
      "estoque reservado (XOR)",
    );
    assert.deepEqual(await historico(cliente, o.id), [
      {
        old_status: null,
        new_status: "pending",
        notes: "Venda no balcão — aguardando o PIX",
      },
    ]);
    const pagamentos = await um(
      cliente,
      "SELECT count(*)::int AS n FROM public.marketplace_order_payment_history WHERE order_id = $1",
      [o.id],
    );
    assert.equal(pagamentos.n, 0, "payment_history é do recebimento manual");
    assert.deepEqual(
      await movimentosDoPedido(cliente, o.id),
      [],
      "aguardando não entra no Financeiro",
    );
    assert.deepEqual(
      await vendasDoCrm(cliente, o.id),
      [],
      "aguardando não é venda no CRM",
    );
  },
});

PROVAS.push({
  nome: "(c) idempotência: mesma chave = mesmo pedido; chave de dinheiro ou de outro balconista = 23505",
  corpo: async (cliente) => {
    await logar(cliente, U_ADMIN);
    const repetida = await iniciar(
      cliente,
      [{ product_id: P_SIMPLES, quantity: 5 }],
      {
        chave: CHAVE(1),
      },
    );
    assert.equal(repetida.ja_existia, true);
    assert.equal(repetida.order.id, estado.pedido1);
    assert.deepEqual(
      await estoque(cliente),
      { simples: 8, pp: 4 },
      "sem segunda baixa",
    );

    await logar(cliente, U_ADMIN_2);
    await assert.rejects(
      () =>
        iniciar(cliente, [{ product_id: P_SIMPLES, quantity: 1 }], {
          chave: CHAVE(1),
        }),
      (e) => e.code === "23505",
      "outro balconista não recebe o PIX alheio",
    );

    await logar(cliente, U_ADMIN);
    await cliente.query(
      `SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL, NULL, NULL, 0, NULL, $2::uuid)`,
      [JSON.stringify([{ product_id: P_SIMPLES, quantity: 1 }]), CHAVE(2)],
    );
    assert.deepEqual(await estoque(cliente), { simples: 7, pp: 4 });
    await assert.rejects(
      () =>
        iniciar(cliente, [{ product_id: P_SIMPLES, quantity: 1 }], {
          chave: CHAVE(2),
        }),
      (e) => e.code === "23505",
      "a chave de uma venda em dinheiro não devolve a venda em dinheiro como PIX",
    );
    assert.deepEqual(await estoque(cliente), { simples: 7, pp: 4 });
  },
});

PROVAS.push({
  nome: "(d) pago → entregue pelo gatilho; Financeiro na conta Mercado Pago; CRM conta; 2ª confirmação não duplica",
  corpo: async (cliente) => {
    const id = estado.pedido1;
    await cliente.query(
      "UPDATE public.marketplace_orders SET gateway_payment_id = 'ORDTST-BALCAO-1' WHERE id = $1",
      [id],
    );
    assert.equal(await confirmar(cliente, id, "ORDTST-BALCAO-1"), "pago");
    const o = await um(
      cliente,
      "SELECT status, payment_status, paid_at FROM public.marketplace_orders WHERE id = $1",
      [id],
    );
    assert.equal(o.status, "delivered", "o cliente levou a mercadoria");
    assert.equal(o.payment_status, "pago");
    assert.ok(o.paid_at instanceof Date);
    assert.deepEqual(
      await estoque(cliente),
      { simples: 7, pp: 4 },
      "estoque não se mexe no pagamento",
    );
    const h = await historico(cliente, id);
    assert.deepEqual(h[h.length - 1], {
      old_status: "pending",
      new_status: "delivered",
      notes: "Venda no balcão — PIX confirmado",
    });

    const mov = await movimentosDoPedido(cliente, id);
    assert.equal(mov.length, 1);
    assert.equal(mov[0].origem, "venda_balcao");
    assert.equal(mov[0].tipo, "entrada");
    assert.equal(mov[0].status, "realizado");
    assert.equal(num(mov[0].valor), 57);
    assert.equal(mov[0].conta_id, MP, "PIX com QR cai na conta Mercado Pago");
    assert.equal(mov[0].forma_pagamento, "pix");
    const crm = await vendasDoCrm(cliente, id);
    assert.equal(crm.length, 1, "venda paga entra no CRM");
    assert.equal(crm[0].canal, "presencial");

    assert.equal(await confirmar(cliente, id, "ORDTST-BALCAO-1"), "ja_pago");
    assert.equal(
      (await historico(cliente, id)).length,
      h.length,
      "sem histórico duplicado",
    );
  },
});

PROVAS.push({
  nome: "(e) expira sem pagar → estoque de volta; pagamento tardio = pago_apos_expirar, nunca entregue",
  corpo: async (cliente) => {
    await logar(cliente, U_ADMIN);
    const venda = await iniciar(
      cliente,
      [{ product_id: P_SIMPLES, quantity: 3 }],
      {
        chave: CHAVE(3),
      },
    );
    const id = venda.order.id;
    assert.deepEqual(await estoque(cliente), { simples: 4, pp: 4 });
    await cliente.query(
      "UPDATE public.marketplace_orders SET gateway_payment_id = 'ORDTST-BALCAO-3', expires_at = now() - interval '1 minute' WHERE id = $1",
      [id],
    );
    await cliente.query("SELECT public.expirar_pedidos_vencidos()");
    let o = await um(
      cliente,
      "SELECT status, payment_status FROM public.marketplace_orders WHERE id = $1",
      [id],
    );
    assert.deepEqual(o, { status: "cancelled", payment_status: "expirado" });
    assert.deepEqual(
      await estoque(cliente),
      { simples: 7, pp: 4 },
      "a reserva voltou",
    );

    assert.equal(
      await confirmar(cliente, id, "ORDTST-BALCAO-3"),
      "pago_apos_expirar",
    );
    o = await um(
      cliente,
      "SELECT status, payment_status FROM public.marketplace_orders WHERE id = $1",
      [id],
    );
    assert.deepEqual(o, {
      status: "cancelled",
      payment_status: "pago_apos_expirar",
    });
    assert.ok(
      !(await historico(cliente, id)).some((l) => l.new_status === "delivered"),
      "pago depois de expirar é caso de atenção, não de entrega",
    );
  },
});

PROVAS.push({
  nome: "(f) cancelado pela loja antes de pagar → estoque de volta; pagamento tardio fica cancelado",
  corpo: async (cliente) => {
    await logar(cliente, U_ADMIN);
    const venda = await iniciar(
      cliente,
      [{ product_id: P_SIMPLES, quantity: 1 }],
      {
        chave: CHAVE(4),
      },
    );
    const id = venda.order.id;
    assert.deepEqual(await estoque(cliente), { simples: 6, pp: 4 });
    await cliente.query(
      "UPDATE public.marketplace_orders SET gateway_payment_id = 'ORDTST-BALCAO-4' WHERE id = $1",
      [id],
    );
    await cliente.query(
      "SELECT public.update_order_status_atomic($1, 'cancelled', 'PIX do balcão cancelado', false)",
      [id],
    );
    assert.deepEqual(await estoque(cliente), { simples: 7, pp: 4 });
    assert.equal(
      await confirmar(cliente, id, "ORDTST-BALCAO-4"),
      "pago_apos_expirar",
    );
    const o = await um(
      cliente,
      "SELECT status FROM public.marketplace_orders WHERE id = $1",
      [id],
    );
    assert.equal(o.status, "cancelled");
  },
});

PROVAS.push({
  nome: "(g) o gatilho não alcança pedido do site",
  corpo: async (cliente) => {
    await cliente.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
          payment_method, metodo_online, payment_status, expires_at, gateway_payment_id)
       VALUES ($1, $2, 'Cliente do Site', '{}'::jsonb, 10, 10, 'pending', 'online',
               'online', 'pix', 'aguardando', now() + interval '30 minutes', 'ORDTST-SITE-1')`,
      [ORDER_SITE, U_CLIENTE],
    );
    assert.equal(await confirmar(cliente, ORDER_SITE, "ORDTST-SITE-1"), "pago");
    const o = await um(
      cliente,
      "SELECT status FROM public.marketplace_orders WHERE id = $1",
      [ORDER_SITE],
    );
    assert.equal(
      o.status,
      "pending",
      "pedido do site pago segue para separação, não 'entregue'",
    );
  },
});

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(
          "Prova viva do PIX do balcão (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "Uma regra do PIX do balcão foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[pix-do-balcao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva do PIX do balcão (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
