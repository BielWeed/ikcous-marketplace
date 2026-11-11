"use strict";

/**
 * get_category_analytics VIVA (20261199000000): pedido sem pagamento não
 * aumenta receita, contagem nem ticket da categoria. Admin atual autenticado.
 * Só TESTE: mutante no clone prova_*, corpo original restaurado no finally.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/analise-por-categoria-so-conta-pedido-pago-viva.cjs
 */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const SIG =
  "public.get_category_analytics(timestamp with time zone,timestamp with time zone)";
const ADMIN = "ca990000-0000-4000-8000-000000000001";
const CLIENTE = "ca990000-0000-4000-8000-000000000002";
const CATEGORIA = "Categoria fictícia R99";
const CLAIMS = JSON.stringify({
  sub: ADMIN,
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const GUARDA =
  "          AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))";
let C;

async function definicao() {
  const r = await C.query(
    "SELECT pg_get_functiondef(to_regprocedure($1)) AS d",
    [SIG],
  );
  assert.equal(typeof r.rows[0].d, "string", "RPC viva não encontrada");
  return r.rows[0].d;
}

async function semear() {
  for (const [id, papel] of [
    [ADMIN, "admin"],
    [CLIENTE, "customer"],
  ]) {
    await C.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1::uuid, $1::text || '@categoria-r99.invalid', $2::jsonb)`,
      [id, JSON.stringify({ role: papel })],
    );
    await C.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, 'Pessoa fictícia R99', $2) ON CONFLICT (id) DO NOTHING`,
      [id, papel],
    );
  }
  const produto = randomUUID();
  await C.query(
    `INSERT INTO public.produtos
       (id, nome, categoria, preco_venda, custo, estoque, ativo)
     VALUES ($1, 'Produto fictício R99', $2, 100, 40, 100, true)`,
    [produto, CATEGORIA],
  );

  // Um único produto/categoria; quantidades diferentes tornam os três números
  // sensíveis ao mutante. Total = subtotal, sem frete nem cupom: rateio = 1.
  for (const [pagamento, status, quantidade, total] of [
    ["pago", "delivered", 1, 100],
    ["recebido_na_entrega", "delivered", 2, 200],
    ["aguardando", "delivered", 3, 300],
    [null, "delivered", 4, 400],
    ["pago", "cancelled", 5, 500],
  ]) {
    const pedido = randomUUID();
    await C.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, shipping,
          discount, status, canal, payment_method, payment_status, created_at)
       VALUES ($1, $2, 'Pessoa fictícia R99', '{}'::jsonb, $3, $3, 0,
               0, $4, 'online', 'online', $5, now())`,
      [pedido, CLIENTE, total, status, pagamento],
    );
    await C.query(
      `INSERT INTO public.marketplace_order_items
         (order_id, product_id, product_name, quantity, price)
       VALUES ($1, $2, 'Produto fictício R99', $3, 100)`,
      [pedido, produto, quantidade],
    );
  }
}

async function soContaPedidoPago() {
  await C.query("BEGIN");
  try {
    await semear();
    // Mesmo login da prova admin-atual-portas: papel PostgREST, uid e JWT.
    await C.query("SET LOCAL ROLE authenticated");
    await C.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [ADMIN, CLAIMS],
    );
    const r = await C.query(
      `SELECT * FROM public.get_category_analytics(
         now() - interval '1 hour', now() + interval '1 hour')`,
    );
    const valores = r.rows.map((linha) => ({
      categoria: linha.name,
      valor_total: Number(linha.value),
      num_pedidos: Number(linha.orders),
      ticket_medio: Number(linha.avg_ticket),
    }));
    // Conta feita à mão: R$100 + R$200 = R$300; 2 pedidos; R$300 / 2 = R$150.
    // Aguardando (300), NULL (400) e cancelado pago (500) não entram.
    assert.deepEqual(
      valores,
      [
        {
          categoria: CATEGORIA,
          valor_total: 300,
          num_pedidos: 2,
          ticket_medio: 150,
        },
      ],
      "DINHEIRO_RECONHECIDO: categoria contou pedido sem pagamento ou cancelado",
    );
    return valores;
  } finally {
    await C.query("ROLLBACK");
  }
}

async function provarGuarda(original) {
  console.log(`  VERDE    ${JSON.stringify(await soContaPedidoPago())}`);
  const normalizada = original.replace(/\r\n/g, "\n");
  assert.equal(
    normalizada.split(GUARDA).length - 1,
    1,
    "mutante: a âncora do filtro de pagamento precisa casar exatamente 1x",
  );
  const mutante = normalizada.replace(GUARDA, "");
  assert.notEqual(mutante, normalizada);
  let pego;
  try {
    await C.query(mutante);
    assert.equal(await definicao(), mutante, "o mutante não entrou no banco");
    try {
      await soContaPedidoPago();
    } catch (erro) {
      pego = erro;
    }
  } finally {
    await C.query(original);
    assert.equal(
      await definicao(),
      original,
      "o corpo vivo não foi restaurado",
    );
  }
  assert.ok(
    pego instanceof assert.AssertionError,
    `MUTANTE SOBREVIVEU ou erro SQL/timeout: ${pego?.stack}`,
  );
  assert.match(pego.message, /^DINHEIRO_RECONHECIDO:/);
  console.log(`  VERMELHO ${pego.message.split("\n")[0]}`);
  console.log(
    `           observado sem filtro: ${JSON.stringify(pego.actual)}`,
  );
  console.log(
    `  VERDE    restaurado: ${JSON.stringify(await soContaPedidoPago())}`,
  );
}

async function main() {
  C = new Client({
    connectionString: lerDatabaseUrlEfemera(),
    statement_timeout: 10000,
  });
  try {
    await C.connect();
    const db = (await C.query("SELECT current_database() AS d")).rows[0].d;
    assert.ok(
      db.startsWith("prova_"),
      "use rodar-isolado.cjs: nunca mutar o banco base",
    );
    const original = await definicao();
    const hash = await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIG],
    );
    console.log(`Corpo VIVO de get_category_analytics: ${hash.rows[0].h}`);
    await provarGuarda(original);
    console.log(
      "\nanalise-por-categoria-so-conta-pedido-pago-viva: 1/1 controle morto; verde/vermelho/verde",
    );
  } finally {
    await C.end().catch(() => {});
  }
}

main().catch((erro) =>
  falhar("ANALISE-POR-CATEGORIA", erro.stack ?? String(erro)),
);
