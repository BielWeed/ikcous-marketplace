"use strict";

const assert = require("node:assert/strict");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");

// Só no banco descartável, dentro de transação desfeita.
const id = (n) => `56000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1);
const cliente = id(2);

async function cancelarComo(c, pedido, ator) {
  await c.query("SET LOCAL ROLE authenticated");
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [
      ator,
      JSON.stringify({
        sub: ator,
        role: "authenticated",
        app_metadata: { role: ator === admin ? "admin" : "customer" },
      }),
    ],
  );
  await c.query(
    "SELECT public.update_order_status_atomic($1::uuid, 'cancelled', NULL, false)",
    [pedido],
  );
  await c.query("RESET ROLE");
}

async function cenario(c, i, caso) {
  const {
    nome,
    status,
    modalidade,
    historico,
    pagamento,
    canal,
    repoe,
    estorna,
    carimbo,
    ator = admin,
  } = caso;
  const produto = id(10 + 2 * i);
  const pedido = id(11 + 2 * i);
  await c.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo)
     VALUES ($1, 'Peça-fixture', 10, 50, 10, true)`,
    [produto],
  );
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, paid_at, cancelled_after_shipping)
     VALUES ($1, $2, 'Comprador fixture', $3, 100, 100, $4, $5, $6, $7,
        CASE WHEN $7::text IS NULL THEN NULL ELSE now() END, $8)`,
    [
      pedido,
      ator,
      JSON.stringify(
        modalidade === null ? {} : { shipping_option_id: modalidade },
      ),
      status,
      canal,
      pagamento === "pago" ? "online" : "cash",
      pagamento,
      historico,
    ],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, 'Peça-fixture', 2, 50)`,
    [pedido, produto],
  );

  await cancelarComo(c, pedido, ator);
  if (repoe) await cancelarComo(c, pedido, ator); // não credita nem estorna duas vezes

  const {
    rows: [linha],
  } = await c.query(
    `SELECT o.status, o.cancelled_after_shipping, (o.stock_returned_at IS NOT NULL) AS reposto,
            p.estoque,
            (SELECT count(*)::int FROM public.order_refunds r WHERE r.order_id = o.id) AS estornos,
            (SELECT sum(amount)::int FROM public.order_refunds r WHERE r.order_id = o.id) AS valor
       FROM public.marketplace_orders o CROSS JOIN public.produtos p
      WHERE o.id = $1 AND p.id = $2`,
    [pedido, produto],
  );
  assert.deepEqual(
    linha,
    {
      status: "cancelled",
      cancelled_after_shipping: carimbo,
      reposto: repoe,
      estoque: repoe ? 12 : 10,
      estornos: estorna ? 1 : 0,
      valor: estorna ? 100 : null,
    },
    nome,
  );
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("GRANT USAGE ON SCHEMA auth TO authenticated");
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'admin@retirada5600.fixture.invalid', '{"role":"admin"}'::jsonb),
              ($2, 'cliente@retirada5600.fixture.invalid', '{"role":"customer"}'::jsonb)`,
      [admin, cliente],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Admin fixture', 'admin'), ($2, 'Cliente fixture', 'customer')
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
      [admin, cliente],
    );
    const base = {
      status: "shipping",
      modalidade: "store-pickup",
      historico: false,
      pagamento: "pago",
      canal: "online",
      repoe: false,
      estorna: false,
      carimbo: true,
    };
    const casos = [
      {
        ...base,
        nome: "retirada pronta paga online",
        repoe: true,
        estorna: true,
        carimbo: false,
      },
      {
        ...base,
        nome: "retirada pronta sem pagamento",
        pagamento: null,
        repoe: true,
        carimbo: false,
      },
      {
        ...base,
        nome: "retirada pronta paga na loja",
        pagamento: "recebido_na_entrega",
        repoe: true,
        carimbo: false,
      },
      {
        ...base,
        nome: "cliente cancela a própria retirada pronta paga sem estorno nem reposição",
        ator: cliente,
      },
      { ...base, nome: "retirada com histórico", historico: true },
      { ...base, nome: "retirada entregue", status: "delivered" },
      { ...base, nome: "entrega em trânsito", modalidade: "local-delivery" },
      { ...base, nome: "modalidade desconhecida", modalidade: null },
      {
        ...base,
        nome: "identificador quase igual",
        modalidade: "store-pickup-x",
      },
      {
        ...base,
        nome: "venda de balcão",
        status: "delivered",
        modalidade: null,
        canal: "presencial",
        pagamento: "recebido_na_entrega",
        repoe: true,
        carimbo: false,
      },
    ];
    for (const [i, caso] of casos.entries()) await cenario(c, i, caso);
    console.log(
      `${casos.length} cenários de cancelamento verificados no Postgres.`,
    );
  } finally {
    try {
      await c.query("ROLLBACK");
    } finally {
      await c.end();
    }
  }
}

main().catch((erro) => falhar("RETIRADA-PRONTA", erro.message));
