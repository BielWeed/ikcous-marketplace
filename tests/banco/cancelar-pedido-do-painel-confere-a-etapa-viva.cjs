"use strict";

const assert = require("node:assert/strict");
const { setTimeout: esperar } = require("node:timers/promises");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");

const admin = "57000000-0000-4000-8000-000000000001";
const pedido = "57000000-0000-4000-8000-000000000002";
const produto = "57000000-0000-4000-8000-000000000003";
const cancelar =
  "SELECT public.cancelar_pedido_do_painel($1::uuid, $2::text, NULL)";

async function logar(c) {
  await c.query("BEGIN");
  await c.query("SET LOCAL statement_timeout = '10s'");
  await c.query("SET LOCAL ROLE authenticated");
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [
      admin,
      JSON.stringify({
        sub: admin,
        role: "authenticated",
        app_metadata: { role: "admin" },
      }),
    ],
  );
}

async function semear(c) {
  await c.query("GRANT USAGE ON SCHEMA auth TO authenticated");
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1, 'admin@etapa5700.fixture.invalid', '{"role":"admin"}'::jsonb)`,
    [admin],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin fixture', 'admin')
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
    [admin],
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo)
     VALUES ($1, 'Peça-fixture', 10, 50, 10, true)`,
    [produto],
  );
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status)
     VALUES ($1, $2, 'Comprador fixture', '{"shipping_option_id":"local-delivery"}', 100, 100,
        'shipping', 'online', 'cash', NULL)`,
    [pedido, admin],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, 'Peça-fixture', 2, 50)`,
    [pedido, produto],
  );
}

async function travouNoAvanco(c, pid) {
  // Espera limitada e condicionada a uma trava observável, não a uma pausa fixa.
  for (let tentativa = 0; tentativa < 100; tentativa++) {
    const {
      rows: [linha],
    } = await c.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (linha?.wait_event_type === "Lock") return true;
    await esperar(20);
  }
  return false;
}

async function main() {
  const connectionString = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString });
  const a = new Client({ connectionString });
  const b = new Client({ connectionString });
  try {
    await Promise.all([c.connect(), a.connect(), b.connect()]);
    await semear(c);
    await logar(a);
    await logar(b);
    await a.query(
      "SELECT public.avancar_status_do_pedido($1::uuid, 'shipping', 'delivered', NULL)",
      [pedido],
    );
    const resultado = b.query(cancelar, [pedido, "shipping"]).then(
      () => null,
      (erro) => erro,
    );
    const bloqueado = await travouNoAvanco(c, b.processID);
    await a.query("COMMIT");
    const erro = await resultado;
    await b.query("ROLLBACK");
    assert.ok(
      bloqueado,
      "o cancelamento precisa esperar a trava da finalização",
    );
    assert.match(
      erro?.message ?? "",
      /pedido_status_mudou: O pedido mudou de situação/,
    );
    const {
      rows: [estado],
    } = await c.query(
      `SELECT o.status, o.cancelled_after_shipping, o.stock_returned_at, p.estoque,
            (SELECT count(*)::int FROM public.order_refunds r WHERE r.order_id = o.id) AS estornos,
            (SELECT count(*)::int FROM public.marketplace_order_history h
              WHERE h.order_id = o.id AND h.new_status = 'cancelled') AS cancelamentos
       FROM public.marketplace_orders o CROSS JOIN public.produtos p
      WHERE o.id = $1 AND p.id = $2`,
      [pedido, produto],
    );
    assert.deepEqual(estado, {
      status: "delivered",
      cancelled_after_shipping: false,
      stock_returned_at: null,
      estoque: 10,
      estornos: 0,
      cancelamentos: 0,
    });

    await logar(b);
    await b.query("SAVEPOINT conferir_etapa");
    await assert.rejects(b.query(cancelar, [pedido, null]), { code: "22023" });
    await b.query("ROLLBACK TO SAVEPOINT conferir_etapa");
    const { rows } = await b.query(cancelar, [pedido, "delivered"]);
    assert.equal(rows[0].cancelar_pedido_do_painel.status, "cancelled");
    await b.query("ROLLBACK");
    console.log(
      "Finalização vence o cancelamento antigo; confirmar a nova etapa funciona.",
    );
  } finally {
    // Encerrar quem segura o pedido primeiro destrava a outra conexão em caso de falha.
    await a.end().catch(() => {});
    await b.end().catch(() => {});
    await c.end().catch(() => {});
  }
}

main().catch((erro) => falhar("CANCELAMENTO-ETAPA", erro.message));
