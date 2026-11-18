"use strict";

/**
 * get_category_analytics VIVA (20261199000000): pedido sem pagamento não
 * aumenta receita, contagem nem ticket da categoria. Admin atual autenticado.
 * Também o RATEIO: um pedido com itens de duas categorias (100 e 50, cupom 30,
 * frete 20, total 140) reparte o total entre elas (93,33 e 46,67) e a soma das
 * categorias é a receita do painel (get_admin_analytics_v2 executive.totalRevenue).
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

async function semearUsuarios() {
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
}

async function semear() {
  await semearUsuarios();
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

// ---------------------------------------------------------------------------
// O rateio: um pedido com itens de DUAS categorias reparte o `total` (que já
// leva cupom e frete) na proporção do que cada categoria vendeu. A prova acima
// usa uma categoria só (rateio sempre 1) e não enxerga esta conta.
// ---------------------------------------------------------------------------
const CATEGORIA_A = "Categoria A fictícia R99";
const CATEGORIA_B = "Categoria B fictícia R99";

async function semearRateio() {
  await semearUsuarios();
  const produtoA = randomUUID();
  const produtoB = randomUUID();
  for (const [id, nome, categoria, preco] of [
    [produtoA, "Produto A fictício R99", CATEGORIA_A, 100],
    [produtoB, "Produto B fictício R99", CATEGORIA_B, 50],
  ]) {
    await C.query(
      `INSERT INTO public.produtos
         (id, nome, categoria, preco_venda, custo, estoque, ativo)
       VALUES ($1, $2, $3, $4, 10, 100, true)`,
      [id, nome, categoria, preco],
    );
  }
  // Pedido 1: A 100 + B 50 = subtotal 150; cupom 30 e frete 20 => total 140.
  // Pedido 2: só A, 2 x 100, sem cupom nem frete => total 200 (rateio 1).
  for (const [total, subtotal, frete, desconto, itens] of [
    [
      140,
      150,
      20,
      30,
      [
        [produtoA, "Produto A fictício R99", 1, 100],
        [produtoB, "Produto B fictício R99", 1, 50],
      ],
    ],
    [200, 200, 0, 0, [[produtoA, "Produto A fictício R99", 2, 100]]],
  ]) {
    const pedido = randomUUID();
    await C.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, shipping,
          discount, status, canal, payment_method, payment_status, created_at)
       VALUES ($1, $2, 'Pessoa fictícia R99', '{}'::jsonb, $3, $4, $5,
               $6, 'delivered', 'online', 'online', 'pago', now())`,
      [pedido, CLIENTE, total, subtotal, frete, desconto],
    );
    for (const [produto, nome, quantidade, preco] of itens) {
      await C.query(
        `INSERT INTO public.marketplace_order_items
           (order_id, product_id, product_name, quantity, price)
         VALUES ($1, $2, $3, $4, $5)`,
        [pedido, produto, nome, quantidade, preco],
      );
    }
  }
}

const centavos = (valor) => Math.round(Number(valor) * 100) / 100;

/** Roda a conta do rateio no corpo que estiver no banco; sempre desfaz. */
async function oRateioReparteOTotal() {
  await C.query("BEGIN");
  try {
    await semearRateio();
    await C.query("SET LOCAL ROLE authenticated");
    await C.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [ADMIN, CLAIMS],
    );
    const r = await C.query(
      `SELECT * FROM public.get_category_analytics(
         now() - interval '1 hour', now() + interval '1 hour')`,
    );
    const painel = await C.query(
      "SELECT public.get_admin_analytics_v2(30) AS r",
    );
    const receita = Number(painel.rows[0].r.executive.totalRevenue);
    const valores = r.rows.map((linha) => ({
      categoria: linha.name,
      valor_total: centavos(linha.value),
      num_pedidos: Number(linha.orders),
      ticket_medio: centavos(linha.avg_ticket),
    }));
    // Conta feita à mão. Pedido 1 (total 140, subtotal 150): A leva 140 x 100/150
    // = 93,33 e B leva 140 x 50/150 = 46,67 (cupom e frete rateados). Pedido 2
    // (200) é todo da A. A = 93,33 + 200 = 293,33 em 2 pedidos (ticket 146,67);
    // B = 46,67 em 1 pedido.
    assert.deepEqual(
      valores,
      [
        {
          categoria: CATEGORIA_A,
          valor_total: 293.33,
          num_pedidos: 2,
          ticket_medio: 146.67,
        },
        {
          categoria: CATEGORIA_B,
          valor_total: 46.67,
          num_pedidos: 1,
          ticket_medio: 46.67,
        },
      ],
      "RATEIO_DA_CATEGORIA: a conta de cada categoria não é a parte dela do total do pedido",
    );
    // A soma das categorias é o dinheiro do painel: nem um centavo a mais nem a menos.
    const soma = r.rows.reduce((s, linha) => s + Number(linha.value), 0);
    assert.equal(receita, 340, "RATEIO_DA_CATEGORIA: totalRevenue do painel");
    assert.ok(
      Math.abs(soma - receita) < 1e-9,
      `RATEIO_DA_CATEGORIA: a soma das categorias (${soma}) tem de ser a receita do painel (${receita})`,
    );
    return { valores, soma, receita };
  } finally {
    await C.query("ROLLBACK");
  }
}

// Cada mutante troca UM trecho do corpo vivo (que tem de aparecer exatamente 1x:
// se sumir, a prova falha alto em vez de passar sem testar nada).
const MUTANTES_DO_RATEIO = [
  [
    "subtotal do pedido particionado por categoria (cada categoria leva o total inteiro)",
    "PARTITION BY i.order_id)",
    "PARTITION BY i.order_id, i.nome_categoria)",
  ],
  [
    "valor da categoria sem a conta com o total (cupom e frete ficam de fora)",
    "SUM(p.total * f.subtotal_categoria\n            / NULLIF(f.subtotal_pedido, 0))::numeric AS valor_total,",
    "SUM(f.subtotal_categoria)::numeric AS valor_total,",
  ],
  [
    "ticket dividido por 1 em vez da contagem de pedidos",
    "/ COUNT(DISTINCT f.order_id),",
    "/ 1,",
  ],
  [
    "ticket arredondado em reais inteiros",
    "            2\n        ) AS ticket_medio",
    "            0\n        ) AS ticket_medio",
  ],
];

async function provarRateio(original) {
  console.log(
    `  VERDE    ${JSON.stringify((await oRateioReparteOTotal()).valores)}`,
  );
  const normalizada = original.replace(/\r\n/g, "\n");
  for (const [rotulo, ancora, troca] of MUTANTES_DO_RATEIO) {
    assert.equal(
      normalizada.split(ancora).length - 1,
      1,
      `mutante "${rotulo}": a âncora precisa casar exatamente 1x`,
    );
    const mutante = normalizada.replace(ancora, troca);
    assert.notEqual(mutante, normalizada);
    let pego;
    try {
      await C.query(mutante);
      assert.equal(await definicao(), mutante, "o mutante não entrou no banco");
      try {
        await oRateioReparteOTotal();
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
      `MUTANTE SOBREVIVEU ou erro SQL/timeout (${rotulo}): ${pego?.stack}`,
    );
    assert.match(pego.message, /^RATEIO_DA_CATEGORIA:/);
    console.log(`  VERMELHO ${rotulo}`);
    console.log(`           ${pego.message.split("\n")[0]}`);
    console.log(`           observado: ${JSON.stringify(pego.actual)}`);
  }
  console.log(
    `  VERDE    restaurado: ${JSON.stringify((await oRateioReparteOTotal()).valores)}`,
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
    await provarRateio(original);
    console.log(
      `\nanalise-por-categoria-so-conta-pedido-pago-viva: 1/1 controle do pagamento e ${MUTANTES_DO_RATEIO.length}/${MUTANTES_DO_RATEIO.length} do rateio mortos; verde/vermelho/verde`,
    );
  } finally {
    await C.end().catch(() => {});
  }
}

main().catch((erro) =>
  falhar("ANALISE-POR-CATEGORIA", erro.stack ?? String(erro)),
);
