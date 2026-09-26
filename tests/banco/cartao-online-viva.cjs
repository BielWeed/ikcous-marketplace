"use strict";

/**
 * PROVA VIVA da migration 20261176000000_o_cartao_online_nasce.sql (plano
 * docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md, tarefa 2)
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero.
 *
 *   (a) configuração: nasce DESLIGADA; visitante lê; só admin salva; teto de
 *       parcelas fora de 1..12 é recusado.
 *   (b) colunas do pedido: pedido existente fica com 0/NULL/NULL; CHECKs
 *       recusam método e parcelas inválidos.
 *   (c) liberar_cobranca_do_pedido: solta só a cobrança que AINDA é a
 *       gravada, só com o pedido aguardando e sem pagamento, conta a
 *       tentativa; sem id, só conta quando a vaga está vazia.
 *   (d) liberar_cobranca_do_pedido é do service role: authenticated não
 *       executa.
 *   (7) achado 7 da revisão de 26/09/2026 (rodada 2): confirmar_pagamento
 *       ('estornado') — o caminho DIRETO do Mercado Pago, fora de
 *       registrar_estorno_manual — também carimba estorno_manual_registrado_em
 *       pelo gatilho novo, e uma edição qualquer POSTERIOR do pedido não
 *       empurra esse carimbo (a mesma razão do achado F, por outra porta).
 *
 * USO: node tests/banco/cartao-online-viva.cjs (depois de provisionar.cjs e
 * aplicar-migrations.cjs, como no rpc-ci.yml)
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const U_CLIENTE = "41111111-1111-1111-1111-111111111111";
const U_ADMIN = "42222222-2222-2222-2222-222222222222";
const O_AGUARDANDO = "4ccccccc-0000-0000-0000-000000000001";
const O_PAGO = "4ccccccc-0000-0000-0000-000000000002";

async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId,
  ]);
}

async function linhaDoPedido(cliente, id) {
  const r = await cliente.query(
    `SELECT gateway_payment_id, tentativas_de_pagamento, metodo_online, parcelas
       FROM public.marketplace_orders WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}

async function liberar(cliente, id, gateway) {
  const r = await cliente.query(
    "SELECT public.liberar_cobranca_do_pedido($1::uuid, $2::text) AS r",
    [id, gateway],
  );
  return r.rows[0].r;
}

const PROVAS = [];

PROVAS.push({
  nome: "(a) configuração nasce desligada, visitante lê, só admin salva, teto 1..12",
  corpo: async (cliente) => {
    for (const [id, email, meta] of [
      [U_CLIENTE, "cliente@cartao.teste", "{}"],
      [U_ADMIN, "admin@cartao.teste", '{"role":"admin"}'],
    ]) {
      await cliente.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [id, email, meta],
      );
    }
    await cliente.query("BEGIN");
    try {
      await cliente.query("SET LOCAL ROLE anon");
      const r = await cliente.query(
        "SELECT credito, debito, parcelas_max FROM public.config_pagamento_cartao WHERE id = 1",
      );
      assert.deepEqual(r.rows[0], {
        credito: false,
        debito: false,
        parcelas_max: 1,
      });
      await cliente.query("SAVEPOINT s1");
      await assert.rejects(
        () =>
          cliente.query(
            "UPDATE public.config_pagamento_cartao SET credito = true",
          ),
        /permission denied/,
      );
      await cliente.query("ROLLBACK TO SAVEPOINT s1");
      // Achado L (revisão de 26/09/2026): grant por coluna — anon lê
      // credito/debito/parcelas_max/updated_at, mas não updated_by (o uuid
      // do admin que mexeu por último não é dado público).
      await assert.rejects(
        () =>
          cliente.query(
            "SELECT updated_by FROM public.config_pagamento_cartao WHERE id = 1",
          ),
        /permission denied/,
      );
    } finally {
      await cliente.query("ROLLBACK");
    }

    await logar(cliente, U_CLIENTE);
    await assert.rejects(
      () =>
        cliente.query(
          "SELECT public.salvar_config_pagamento_cartao(true, true, 6)",
        ),
      /Acesso negado/,
    );
    await logar(cliente, U_ADMIN);
    await assert.rejects(
      () =>
        cliente.query(
          "SELECT public.salvar_config_pagamento_cartao(true, false, 13)",
        ),
      /1 a 12/,
    );
    const salvo = (
      await cliente.query(
        "SELECT public.salvar_config_pagamento_cartao(true, true, 6) AS r",
      )
    ).rows[0].r;
    assert.equal(salvo.credito, true);
    assert.equal(salvo.debito, true);
    assert.equal(salvo.parcelas_max, 6);
  },
});

PROVAS.push({
  nome: "(b) colunas do pedido: defaults de hoje e CHECKs",
  corpo: async (cliente) => {
    await cliente.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
          payment_method, payment_status, expires_at, gateway_payment_id)
       VALUES ($1, $3, 'Cliente Cartão', '{}'::jsonb, 50, 50, 'pending', 'online',
               'online', 'aguardando', now() + interval '30 minutes', 'ORD-CARTAO-1'),
              ($2, $3, 'Cliente Cartão', '{}'::jsonb, 50, 50, 'processing', 'online',
               'online', 'pago', now() + interval '30 minutes', 'ORD-CARTAO-2')`,
      [O_AGUARDANDO, O_PAGO, U_CLIENTE],
    );
    await cliente.query(
      "UPDATE public.marketplace_orders SET paid_at = now() WHERE id = $1",
      [O_PAGO],
    );
    const linha = await linhaDoPedido(cliente, O_AGUARDANDO);
    assert.equal(linha.tentativas_de_pagamento, 0);
    assert.equal(linha.metodo_online, null);
    assert.equal(linha.parcelas, null);
    await assert.rejects(
      () =>
        cliente.query(
          "UPDATE public.marketplace_orders SET metodo_online = 'boleto' WHERE id = $1",
          [O_AGUARDANDO],
        ),
      /metodo_online_check/,
    );
    await assert.rejects(
      () =>
        cliente.query(
          "UPDATE public.marketplace_orders SET parcelas = 13 WHERE id = $1",
          [O_AGUARDANDO],
        ),
      /parcelas_check/,
    );
  },
});

PROVAS.push({
  nome: "(c) liberar_cobranca_do_pedido solta só a cobrança gravada, com o pedido aguardando",
  corpo: async (cliente) => {
    await cliente.query(
      "UPDATE public.marketplace_orders SET metodo_online = 'credito', parcelas = 3 WHERE id = $1",
      [O_AGUARDANDO],
    );
    // Resposta atrasada de outra cobrança: não mexe.
    assert.equal(await liberar(cliente, O_AGUARDANDO, "ORD-ANTIGA"), false);
    assert.equal(
      (await linhaDoPedido(cliente, O_AGUARDANDO)).gateway_payment_id,
      "ORD-CARTAO-1",
    );
    // Sem id com a vaga ocupada: não conta.
    assert.equal(await liberar(cliente, O_AGUARDANDO, null), false);

    assert.equal(await liberar(cliente, O_AGUARDANDO, "ORD-CARTAO-1"), true);
    let linha = await linhaDoPedido(cliente, O_AGUARDANDO);
    assert.equal(linha.gateway_payment_id, null);
    assert.equal(linha.metodo_online, null);
    assert.equal(linha.parcelas, null);
    assert.equal(linha.tentativas_de_pagamento, 1);
    // Segunda vez: nada a liberar.
    assert.equal(await liberar(cliente, O_AGUARDANDO, "ORD-CARTAO-1"), false);
    // Recusa imediata (sem id, vaga vazia): conta a tentativa.
    assert.equal(await liberar(cliente, O_AGUARDANDO, null), true);
    linha = await linhaDoPedido(cliente, O_AGUARDANDO);
    assert.equal(linha.tentativas_de_pagamento, 2);
    // Pedido pago nunca perde a cobrança.
    assert.equal(await liberar(cliente, O_PAGO, "ORD-CARTAO-2"), false);
    assert.equal(
      (await linhaDoPedido(cliente, O_PAGO)).gateway_payment_id,
      "ORD-CARTAO-2",
    );
  },
});

PROVAS.push({
  nome: "(d) liberar_cobranca_do_pedido é só do service role",
  corpo: async (cliente) => {
    await cliente.query("BEGIN");
    try {
      await logar(cliente, U_CLIENTE);
      await cliente.query("SET LOCAL ROLE authenticated");
      await assert.rejects(
        () => liberar(cliente, O_AGUARDANDO, null),
        /permission denied/,
      );
    } finally {
      await cliente.query("ROLLBACK");
    }
    await cliente.query("BEGIN");
    try {
      await cliente.query("SET LOCAL ROLE service_role");
      assert.equal(await liberar(cliente, O_AGUARDANDO, null), true);
    } finally {
      await cliente.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(7) confirmar_pagamento('estornado') carimba o mesmo campo que registrar_estorno_manual",
  corpo: async (cliente) => {
    const antes = (
      await cliente.query(
        "SELECT estorno_manual_registrado_em FROM public.marketplace_orders WHERE id = $1",
        [O_PAGO],
      )
    ).rows[0];
    assert.equal(
      antes.estorno_manual_registrado_em,
      null,
      "O_PAGO ainda não foi estornado por nenhum caminho",
    );

    // O caminho DIRETO (gateway avisando por fora do ledger de order_refunds
    // — nunca passa por registrar_estorno_manual): mesmo assim o gatilho do
    // achado 7 carimba.
    await cliente.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'estornado') AS r",
      [O_PAGO, "ORD-CARTAO-2"],
    );
    const depois = (
      await cliente.query(
        "SELECT payment_status, estorno_manual_registrado_em FROM public.marketplace_orders WHERE id = $1",
        [O_PAGO],
      )
    ).rows[0];
    assert.equal(depois.payment_status, "estornado");
    assert.notEqual(
      depois.estorno_manual_registrado_em,
      null,
      "achado 7: o gatilho carimba mesmo sem passar por registrar_estorno_manual",
    );

    // A MESMA razão do achado F, por outra porta: uma edição qualquer
    // POSTERIOR do pedido (aqui, uma coluna que nem é payment_status) não
    // pode empurrar o carimbo — o gatilho é `UPDATE OF payment_status`, e
    // dentro dele só grava na PRIMEIRA vez (COALESCE).
    const carimbo1 = depois.estorno_manual_registrado_em;
    await cliente.query(
      "UPDATE public.marketplace_orders SET notes = 'nota qualquer, sem relação com o estorno' WHERE id = $1",
      [O_PAGO],
    );
    const outraVolta = (
      await cliente.query(
        "SELECT estorno_manual_registrado_em FROM public.marketplace_orders WHERE id = $1",
        [O_PAGO],
      )
    ).rows[0];
    assert.equal(
      outraVolta.estorno_manual_registrado_em.getTime(),
      carimbo1.getTime(),
      "uma edição qualquer depois não pode empurrar o carimbo do estorno",
    );

    // Chamar de novo com o mesmo payment_id: 'ja_estornado', e o carimbo
    // continua o mesmo (não regrava).
    const resultado = await cliente.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'estornado') AS r",
      [O_PAGO, "ORD-CARTAO-2"],
    );
    assert.equal(resultado.rows[0].r, "ja_estornado");
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
          "Prova viva do cartão online (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "Uma regra do cartão online foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(`\n[cartao] ${PROVAS.length}/${PROVAS.length} provas passaram.`);
  anexarAoSummary(
    "Prova viva do cartão online (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
