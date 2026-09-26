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
      await assert.rejects(
        () =>
          cliente.query(
            "UPDATE public.config_pagamento_cartao SET credito = true",
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
