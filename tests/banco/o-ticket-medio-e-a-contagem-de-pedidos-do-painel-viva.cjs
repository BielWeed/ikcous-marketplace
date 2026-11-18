"use strict";

/**
 * get_admin_analytics_v2 VIVA (corpo vigente: 20261399995000): o "Ticket médio" e
 * o "Pedidos" do painel da lojista (executive.totalOrders, executive.avgTicket e
 * averageTicket). Nenhuma outra prova de banco lia esses três números.
 *
 * A conta: ticket = receita de todos os pedidos que contam / quantidade deles,
 * arredondado em centavos. Conta o pedido pago ou pago na entrega que não foi
 * cancelado nem devolvido; aguardando, estornado, sem pagamento e cancelado ficam
 * fora (e não entram nem na receita nem na divisão).
 *
 * Semente (loja LIMPA, uma transação que sempre desfaz): 6 pedidos que contam
 * (130, 100, 20, 30, 45 e 10 = R$ 335) => ticket 335 / 6 = 55,8333 => 55,83. Com 5
 * (sem o de R$ 10) seria 65 exato: a diferença entre 55,83 e 56 (arredondar em
 * reais inteiros) é o que mata os mutantes de arredondamento; o mutante que divide
 * por pedidos + 1 já morre antes, com 5 pedidos (325 / 6 = 54,17, não 65). Fora da
 * conta: cancelado pago (500), devolvido pago (77), aguardando (300), estornado
 * (200), sem forma de pagamento (150). O devolvido tem valor distinto (77) e
 * pagamento aprovado de propósito: só o `status` o deixa de fora, então tirar
 * 'returned' da lista do corpo vivo muda receita, contagem e ticket. ATENÇÃO: a
 * CHECK marketplace_orders_status_check (pending, processing, shipping, delivered,
 * cancelled, new) hoje recusa 'returned'; a prova a derruba SÓ dentro da transação
 * que sempre desfaz, para exercitar a guarda do corpo vivo, e confere no fim que a
 * CHECK voltou byte a byte.
 * Loja sem nenhum pedido: totalOrders 0 e avgTicket 0 (nunca divisão por zero).
 *
 * Só TESTE: o corpo vivo é trocado (mutante) no clone prova_* e restaurado no finally.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-ticket-medio-e-a-contagem-de-pedidos-do-painel-viva.cjs
 */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const SIG = "public.get_admin_analytics_v2(integer)";
const ADMIN = "7c3c0000-0000-4000-8000-000000000001";
const CLAIMS = JSON.stringify({
  sub: ADMIN,
  role: "authenticated",
  app_metadata: { role: "admin" },
});
let C;

async function definicao() {
  const r = await C.query(
    "SELECT pg_get_functiondef(to_regprocedure($1)) AS d",
    [SIG],
  );
  assert.equal(typeof r.rows[0].d, "string", "RPC viva não encontrada");
  return r.rows[0].d;
}

async function checkDoStatus() {
  const r = await C.query(
    `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
      WHERE conrelid = 'public.marketplace_orders'::regclass
        AND conname = 'marketplace_orders_status_check'`,
  );
  return r.rows[0]?.d;
}

async function semearAdmin() {
  await C.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1::uuid, $1::text || '@ticket-r7c.invalid', '{"role":"admin"}'::jsonb)`,
    [ADMIN],
  );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role)
     VALUES ($1, 'Pessoa fictícia R7C', 'admin') ON CONFLICT (id) DO NOTHING`,
    [ADMIN],
  );
}

async function pedido(total, status, pagamento) {
  await C.query(
    `INSERT INTO public.marketplace_orders
       (id, customer_name, customer_data, total, subtotal, shipping, discount,
        status, canal, payment_method, payment_status, created_at)
     VALUES ($1, 'Pessoa fictícia R7C', '{}'::jsonb, $2, $2, 0, 0,
             $3, 'online', 'online', $4, now())`,
    [randomUUID(), total, status, pagamento],
  );
}

/** O que o painel mostra, lido como a lojista (admin atual). Erro de SQL vira falha da prova. */
async function lerPainel() {
  let r;
  let erroSql;
  // Savepoint: um erro de SQL do painel (divisão por zero) não pode abortar a transação
  // antes de a prova reportá-lo como falha dela.
  await C.query("SAVEPOINT leitura_painel");
  // Mesmo login da prova admin-atual-portas: papel PostgREST, uid e JWT. Só a leitura roda
  // como a lojista; a semente (INSERT) roda como o dono do banco.
  await C.query("SET LOCAL ROLE authenticated");
  await C.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [ADMIN, CLAIMS],
  );
  try {
    r = await C.query("SELECT public.get_admin_analytics_v2(30) AS r");
  } catch (erro) {
    erroSql = erro;
  }
  await C.query(
    erroSql
      ? "ROLLBACK TO SAVEPOINT leitura_painel"
      : "RELEASE SAVEPOINT leitura_painel",
  );
  await C.query("RESET ROLE");
  if (erroSql)
    assert.fail(
      `TICKET_DO_PAINEL: o painel nem respondeu (${erroSql.message})`,
    );
  const j = r.rows[0].r;
  return {
    totalOrders: Number(j.executive.totalOrders),
    totalRevenue: Number(j.executive.totalRevenue),
    avgTicket: Number(j.executive.avgTicket),
    averageTicket: Number(j.averageTicket),
  };
}

/** Roda a prova no corpo que estiver no banco; sempre desfaz. */
async function oTicketEAContagem() {
  await C.query("BEGIN");
  try {
    await semearAdmin();

    // Loja sem pedido nenhum: zero pedido, ticket zero (a guarda contra a divisão por zero).
    const vazio = await lerPainel();
    assert.deepEqual(
      vazio,
      { totalOrders: 0, totalRevenue: 0, avgTicket: 0, averageTicket: 0 },
      "TICKET_DO_PAINEL: loja sem pedido tem de mostrar 0 pedido e ticket 0",
    );

    // Os que NÃO contam (se contassem, mudariam a receita, a contagem e a divisão).
    await pedido(500, "cancelled", "pago");
    // Devolvido com pagamento aprovado: só o status o tira da conta (o mutante que
    // tira 'returned' da lista passaria a contá-lo: 6 pedidos, R$ 402). Hoje a CHECK
    // marketplace_orders_status_check NÃO deixa nascer pedido 'returned' (a lista do
    // corpo vivo é defesa para o dia em que ela aceitar), então a CHECK sai só aqui,
    // dentro desta transação, que sempre desfaz (DDL do Postgres é transacional;
    // main() confere que a CHECK voltou idêntica).
    await C.query(
      "ALTER TABLE public.marketplace_orders DROP CONSTRAINT marketplace_orders_status_check",
    );
    await pedido(77, "returned", "pago");
    await pedido(300, "pending", "aguardando");
    await pedido(200, "delivered", "estornado");
    await pedido(150, "delivered", null);
    // Os que contam: pago online, pago na entrega e pedido ainda em andamento já pago.
    await pedido(130, "delivered", "pago");
    await pedido(100, "delivered", "pago");
    await pedido(20, "delivered", "recebido_na_entrega");
    await pedido(30, "processing", "pago");
    await pedido(45, "delivered", "pago_apos_expirar");

    const cinco = await lerPainel();
    assert.deepEqual(
      cinco,
      { totalOrders: 5, totalRevenue: 325, avgTicket: 65, averageTicket: 65 },
      "TICKET_DO_PAINEL: com 5 pedidos que contam (R$ 325) o ticket é 65 e o painel mostra 5 pedidos",
    );

    // O sexto pedido (R$ 10) deixa a divisão quebrada: 335 / 6 = 55,8333... => 55,83 (centavos, não 56).
    await pedido(10, "delivered", "pago");
    const seis = await lerPainel();
    assert.deepEqual(
      seis,
      {
        totalOrders: 6,
        totalRevenue: 335,
        avgTicket: 55.83,
        averageTicket: 55.83,
      },
      "TICKET_DO_PAINEL: com 6 pedidos (R$ 335) o ticket é 55,83 em centavos",
    );
    return { vazio, cinco, seis };
  } finally {
    await C.query("ROLLBACK");
  }
}

// Cada mutante troca UM trecho do corpo vivo (que tem de aparecer exatamente 1x:
// se sumir, a prova falha alto em vez de passar sem testar nada).
const MUTANTES = [
  [
    "ticket dividido por pedidos + 1",
    "THEN total_rev / total_ord ELSE 0 END",
    "THEN total_rev / (total_ord + 1) ELSE 0 END",
  ],
  [
    "ticket sem a guarda de zero pedido (divisão por zero na loja vazia)",
    "avg_ticket := CASE WHEN total_ord > 0 THEN total_rev / total_ord ELSE 0 END;",
    "avg_ticket := total_rev / total_ord;",
  ],
  [
    "avgTicket arredondado em reais inteiros",
    "'avgTicket', round(avg_ticket, 2),",
    "'avgTicket', round(avg_ticket, 0),",
  ],
  [
    "averageTicket arredondado em reais inteiros",
    "'averageTicket', round(avg_ticket, 2),",
    "'averageTicket', round(avg_ticket, 0),",
  ],
  [
    "a conta conta o pedido sem pagamento (aguardando, estornado, sem forma)",
    "INTO total_rev, total_ord\n    FROM public.marketplace_orders\n    WHERE status NOT IN ('cancelled', 'returned')\n    AND (payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'));",
    "INTO total_rev, total_ord\n    FROM public.marketplace_orders\n    WHERE status NOT IN ('cancelled', 'returned');",
  ],
  [
    "a conta conta o pedido cancelado",
    "INTO total_rev, total_ord\n    FROM public.marketplace_orders\n    WHERE status NOT IN ('cancelled', 'returned')\n    AND (payment_status IN",
    "INTO total_rev, total_ord\n    FROM public.marketplace_orders\n    WHERE true\n    AND (payment_status IN",
  ],
  [
    "a conta conta o pedido devolvido (returned some da lista de exclusão)",
    "INTO total_rev, total_ord\n    FROM public.marketplace_orders\n    WHERE status NOT IN ('cancelled', 'returned')\n    AND (payment_status IN",
    "INTO total_rev, total_ord\n    FROM public.marketplace_orders\n    WHERE status NOT IN ('cancelled')\n    AND (payment_status IN",
  ],
  [
    "totalOrders com um pedido a mais",
    "'totalOrders', total_ord,",
    "'totalOrders', total_ord + 1,",
  ],
];

async function provar(original) {
  const normal = await oTicketEAContagem();
  console.log(`  VERDE    vazio=${JSON.stringify(normal.vazio)}`);
  console.log(`           cinco=${JSON.stringify(normal.cinco)}`);
  console.log(`           seis=${JSON.stringify(normal.seis)}`);
  const normalizada = original.replace(/\r\n/g, "\n");
  for (const [rotulo, ancora, troca] of MUTANTES) {
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
        await oTicketEAContagem();
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
      `MUTANTE SOBREVIVEU ou erro fora da prova (${rotulo}): ${pego?.stack}`,
    );
    assert.match(pego.message, /^TICKET_DO_PAINEL:/);
    console.log(`  VERMELHO ${rotulo}`);
    console.log(`           ${pego.message.split("\n")[0]}`);
    console.log(`           observado: ${JSON.stringify(pego.actual)}`);
  }
  const volta = await oTicketEAContagem();
  assert.deepEqual(volta, normal, "o corpo restaurado não repete a leitura");
  console.log(`  VERDE    restaurado: seis=${JSON.stringify(volta.seis)}`);
}

async function main() {
  C = new Client({
    connectionString: lerDatabaseUrlEfemera(),
    statement_timeout: 20000,
  });
  try {
    await C.connect();
    const db = (await C.query("SELECT current_database() AS d")).rows[0].d;
    assert.ok(
      db.startsWith("prova_"),
      "use rodar-isolado.cjs: nunca mutar o banco base",
    );
    const antes = (
      await C.query("SELECT count(*)::int AS n FROM public.marketplace_orders")
    ).rows[0].n;
    assert.equal(
      antes,
      0,
      "a prova mede o ticket exato: a loja tem de partir limpa",
    );
    const original = await definicao();
    const hash = await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIG],
    );
    console.log(`Corpo VIVO de get_admin_analytics_v2: ${hash.rows[0].h}`);
    const checkAntes = await checkDoStatus();
    assert.match(
      checkAntes,
      /cancelled/,
      "a CHECK de status do pedido não foi encontrada",
    );
    await provar(original);
    assert.equal(
      await checkDoStatus(),
      checkAntes,
      "a CHECK de status do pedido não voltou idêntica (a prova a derruba só dentro da transação)",
    );
    console.log(
      `\no-ticket-medio-e-a-contagem-de-pedidos-do-painel-viva: ${MUTANTES.length}/${MUTANTES.length} mutantes mortos; verde/vermelho/verde`,
    );
  } finally {
    await C.end().catch(() => {});
  }
}

main().catch((erro) => falhar("TICKET-DO-PAINEL", erro.stack ?? String(erro)));
