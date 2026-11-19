"use strict";

const assert = require("node:assert/strict");
const { setTimeout: esperar } = require("node:timers/promises");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");

const admin = "57000000-0000-4000-8000-000000000001";
const pedido = "57000000-0000-4000-8000-000000000002";
const produto = "57000000-0000-4000-8000-000000000003";
const comprador = "57000000-0000-4000-8000-000000000004";
const outroCliente = "57000000-0000-4000-8000-000000000005";
const exAdmin = "57000000-0000-4000-8000-000000000006";
const pedidoPago = "57000000-0000-4000-8000-000000000007";
const pedidoComPix = "57000000-0000-4000-8000-000000000008";
const cancelar =
  "SELECT public.cancelar_pedido_do_painel($1::uuid, $2::text, NULL)";

async function logar(c, usuario = admin, papel = "admin") {
  await c.query("BEGIN");
  await c.query("SET LOCAL statement_timeout = '10s'");
  await c.query("SET LOCAL ROLE authenticated");
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [
      usuario,
      JSON.stringify({
        sub: usuario,
        role: "authenticated",
        app_metadata: { role: papel },
      }),
    ],
  );
}

async function semear(c) {
  await c.query("GRANT USAGE ON SCHEMA auth TO authenticated");
  for (const [id, nome, papel] of [
    [admin, "admin", "admin"],
    [comprador, "comprador", "customer"],
    [outroCliente, "outro", "customer"],
    [exAdmin, "ex-admin", "admin"],
  ]) {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, $2, jsonb_build_object('role', $3::text))`,
      [id, `${nome}@etapa5700.fixture.invalid`, papel],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
      [id, nome, papel],
    );
  }
  await c.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo)
     VALUES ($1, 'Peça-fixture', 10, 50, 10, true)`,
    [produto],
  );
  await semearPedido(c, pedido, admin, "shipping", null);
  await semearPedido(c, pedidoPago, comprador, "processing", "pago");
  await semearPedido(c, pedidoComPix, comprador, "pending", "aguardando");
}

async function semearPedido(c, id, usuario, etapa, pagamento) {
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, metodo_online, gateway_payment_id, paid_at)
     VALUES ($1, $2, 'Comprador fixture', '{"shipping_option_id":"local-delivery"}', 100, 100,
        $3, 'online', $4, $5, $6, $7, $8)`,
    [
      id,
      usuario,
      etapa,
      pagamento ? "online" : "cash",
      pagamento,
      pagamento ? "pix" : null,
      pagamento ? `ORD-ETAPA-${id.slice(-1)}` : null,
      pagamento === "pago" ? new Date() : null,
    ],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, 'Peça-fixture', 2, 50)`,
    [id, produto],
  );
}

async function fotoPedido(c, id) {
  const {
    rows: [foto],
  } = await c.query(
    `SELECT to_jsonb(o) AS pedido, p.estoque,
            (SELECT count(*)::int FROM public.order_refunds r WHERE r.order_id = o.id) AS estornos,
            (SELECT count(*)::int FROM public.marketplace_order_history h WHERE h.order_id = o.id) AS historico
       FROM public.marketplace_orders o CROSS JOIN public.produtos p
      WHERE o.id = $1 AND p.id = $2`,
    [id, produto],
  );
  return foto;
}

async function provarRecusas(c, b) {
  await c.query("INSERT INTO public.dono_da_loja (user_id) VALUES ($1)", [
    admin,
  ]);
  await logar(b);
  const { rows } = await b.query(
    "SELECT public.definir_cargo($1::uuid, 'customer') AS r",
    [exAdmin],
  );
  assert.equal(rows[0].r.mudou, true, "a revogação do cargo precisa acontecer");
  await b.query("COMMIT");

  // A etapa confere e, sem a guarda de admin atual, a porta encaminharia
  // qualquer um destes três como admin para cancelar o pedido pago.
  const antes = await fotoPedido(c, pedidoPago);
  assert.equal(antes.pedido.status, "processing");
  assert.equal(antes.pedido.payment_status, "pago");
  assert.equal(antes.estornos, 0);
  for (const [usuario, papel, rotulo] of [
    [comprador, "customer", "dono do pedido"],
    [outroCliente, "customer", "outro cliente"],
    [exAdmin, "admin", "ex-admin com JWT antigo"],
  ]) {
    await logar(b, usuario, papel);
    await assert.rejects(
      b.query(cancelar, [pedidoPago, "processing"]),
      { code: "42501", message: /Acesso negado/ },
      rotulo,
    );
    await b.query("ROLLBACK");
    assert.deepEqual(await fotoPedido(c, pedidoPago), antes, rotulo);
  }

  // Controle: com o papel atual e os mesmos argumentos, o pedido cancela.
  await logar(b);
  const controle = await b.query(cancelar, [pedidoPago, "processing"]);
  assert.equal(controle.rows[0].cancelar_pedido_do_painel.status, "cancelled");
  await b.query("ROLLBACK");
  console.log(
    "Dono do pedido, outro cliente e ex-admin não cancelam pelo painel.",
  );

  // A sessão é de admin e a etapa é a certa: só a cobrança PIX aberta
  // pode explicar esta recusa. Encaminhar como se fosse pela edge a pula.
  const pixAntes = await fotoPedido(c, pedidoComPix);
  assert.equal(pixAntes.pedido.status, "pending");
  assert.equal(pixAntes.pedido.payment_status, "aguardando");
  assert.equal(pixAntes.pedido.metodo_online, "pix");
  assert.ok(pixAntes.pedido.gateway_payment_id);
  await logar(b);
  await assert.rejects(b.query(cancelar, [pedidoComPix, "pending"]), {
    code: "P0001",
    message: /cobrança aberta no Mercado Pago/,
  });
  await b.query("ROLLBACK");
  assert.deepEqual(await fotoPedido(c, pedidoComPix), pixAntes);
  console.log("O painel recusa cancelar PIX com cobrança ainda aberta.");
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
    await provarRecusas(c, b);
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
