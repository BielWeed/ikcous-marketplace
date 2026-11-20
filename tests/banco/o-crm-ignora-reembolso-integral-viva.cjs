"use strict";

// Reproduz no mesmo clone o antes e o depois, sem mudar os pedidos da fixture.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const MIGRACAO = "20261412000000_o_crm_ignora_reembolso_integral.sql";
const ANTES = "168b-antes-o-crm-ignora-reembolso-integral-base-vigente";
const DEPOIS = "168a-conferir-o-crm-ignora-reembolso-integral-aplicado";
const ADMIN = "d0d16800-0000-4000-8000-0000000000a1";
const CLIENTE = "d0d16800-0000-4000-8000-0000000000a2";
const DIA = "2025-05-21";
const PAGO_EM = `${DIA}T12:00:00-03:00`;

const ler = (arquivo) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Caminhos versionados e fixos.
  readFileSync(path.join(__dirname, "../..", arquivo), "utf8");

async function conferir(c, consulta, valida) {
  const { rows } = await c.query(
    ler(`scripts/publicacao/consultas/${consulta}.sql`),
  );
  assert.equal(rows.length, 4);
  assert.equal(
    rows.every((linha) => linha.ok === true),
    valida,
  );
}

async function estado(c) {
  const { rows } = await c.query(
    `SELECT oid, prosrc, proacl, proowner, proconfig
       FROM pg_proc WHERE oid = 'public.crm__vendas(timestamptz)'::regprocedure`,
  );
  return rows[0];
}

async function somas(c) {
  const { rows } = await c.query(
    `SELECT public.crm_visao($1::date, $1::date) AS visao,
            public.crm_clientes(NULL, 'crm224cliente', 50, 0) AS lista`,
    [DIA],
  );
  const { visao, lista } = rows[0];
  assert.equal(lista.total, 1);
  const [cliente] = lista.clientes;
  return {
    clienteReceita: cliente.receita,
    clientePedidos: cliente.pedidos,
    receita: visao.kpis.receita,
    pedidos: visao.kpis.pedidos,
    pagos: visao.funil.pedidos_pagos,
    criados: visao.funil.pedidos_criados,
    taxa: visao.kpis.taxa_devolucao,
  };
}

async function fixture(c) {
  await c.query(
    `INSERT INTO auth.users(id, email, raw_app_meta_data) VALUES
       ($1, 'crm224admin@fixture.test', '{"role":"admin"}'),
       ($2, 'crm224cliente@fixture.test', '{}')`,
    [ADMIN, CLIENTE],
  );
  await c.query(
    `INSERT INTO public.profiles(id, full_name, role) VALUES
       ($1, 'CRM224 admin', 'admin'), ($2, 'crm224cliente', 'customer')
     ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name`,
    [ADMIN, CLIENTE],
  );
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);

  async function pedido(total) {
    const { rows } = await c.query(
      `INSERT INTO public.marketplace_orders
        (user_id, customer_name, customer_data, total, subtotal, status, canal,
         payment_method, payment_status, paid_at, created_at)
       VALUES ($1, 'crm224cliente', '{}', $2, $2, 'delivered', 'online',
               'online', 'pago', $3, $3)
       RETURNING id`,
      [CLIENTE, total, PAGO_EM],
    );
    return rows[0].id;
  }

  let protocolo = 0;
  async function devolver(id, valor, status = "concluida", manual = true) {
    protocolo += 1;
    await c.query(
      `INSERT INTO public.devolucoes
        (protocolo, order_id, user_id, tipo, motivo, resolucao_desejada,
         resolucao_final, modalidade, metodo_retorno, status, valor_itens,
         valor_reembolso, reembolso_manual, prazo_ate, politica, concluida_em)
       VALUES ($1, $2, $3, 'arrependimento', 'desisti', 'reembolso', 'reembolso',
               'local', 'entrega_na_loja', $4, $5, $5, $6, current_date, '{}',
               CASE WHEN $4 = 'concluida' THEN $7::timestamptz END)`,
      [`CRM224-${protocolo}`, id, CLIENTE, status, valor, manual, PAGO_EM],
    );
  }

  async function estornar(id, valor, status) {
    await c.query(
      `INSERT INTO public.order_refunds
        (order_id, amount, solicitado_por, status, concluido_em)
       VALUES ($1, $2, 'lojista', $3, CASE WHEN $3 = 'concluido' THEN $4::timestamptz END)`,
      [id, valor, status, PAGO_EM],
    );
  }

  const integral = await pedido(100);
  await devolver(integral, 100);
  const emDuas = await pedido(100);
  await devolver(emDuas, 30);
  await devolver(emDuas, 70);
  const misto = await pedido(100);
  await devolver(misto, 60);
  await estornar(misto, 40, "concluido");
  const parcial = await pedido(100);
  await devolver(parcial, 99.99);
  await estornar(parcial, 0.01, "solicitado");
  const emAberto = await pedido(100);
  await devolver(emAberto, 100, "recebida");
  const naoManual = await pedido(100);
  await devolver(naoManual, 100, "concluida", false);
  const brinde = await pedido(0);
  return [parcial, emAberto, naoManual, brinde].sort();
}

async function provas(c) {
  await conferir(c, DEPOIS, true);
  const nova = await estado(c);
  const idsMantidos = await fixture(c);
  const { rows } = await c.query(
    "SELECT order_id FROM public.crm__vendas(now()) WHERE user_id = $1 ORDER BY order_id",
    [CLIENTE],
  );
  assert.deepEqual(
    rows.map(({ order_id }) => order_id),
    idsMantidos,
  );
  const controles = { criados: 7, taxa: 0.6667 };
  const depois = {
    ...controles,
    clienteReceita: 300,
    clientePedidos: 4,
    receita: 300,
    pedidos: 4,
    pagos: 4,
  };
  assert.deepEqual(await somas(c), depois);
  console.log(
    "[21412] Integral manual e misto saem da lista e do funil; parcial, pendente e brinde continuam.",
  );

  await c.query(ler(`supabase/migrations/rollback-manual-${MIGRACAO}`));
  await conferir(c, ANTES, true);
  await conferir(c, DEPOIS, false);
  const antiga = await estado(c);
  const { prosrc: corpoNovo, ...atributosNovos } = nova;
  const { prosrc: corpoAntigo, ...atributosAntigos } = antiga;
  assert.notEqual(corpoNovo, corpoAntigo);
  assert.deepEqual(atributosNovos, atributosAntigos);
  assert.deepEqual(await somas(c), {
    ...controles,
    clienteReceita: 600,
    clientePedidos: 7,
    receita: 600,
    pedidos: 7,
    pagos: 7,
  });
  console.log(
    "[21412] Mesmo conjunto no corpo antigo: 7 pagos e R$ 600; taxa e pedidos criados não mudam.",
  );

  await c.query(ler(`supabase/migrations/${MIGRACAO}`));
  await conferir(c, DEPOIS, true);
  assert.deepEqual(await estado(c), nova);
  assert.deepEqual(await somas(c), depois);
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  assert.equal(
    new URL(url).pathname,
    "/prova_o_crm_ignora_reembolso_integral_viva",
    "Rode somente no clone criado por rodar-isolado.cjs.",
  );
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    await provas(c);
  } finally {
    try {
      await c.query("ROLLBACK");
    } finally {
      await c.end();
    }
  }
}

main().catch((erro) => {
  console.error("[21412]", erro);
  process.exitCode = 1;
});
