#!/usr/bin/env node
/**
 * Prova a migration 20260822000100_analitico_conta_so_dinheiro_reconhecido.sql
 * sem comitar nada no banco.
 *
 * TUDO roda em UMA transação terminada em ROLLBACK. Nada é gravado. Isso só
 * é verdade porque a migration NÃO tem BEGIN/COMMIT embutido — se alguém
 * acrescentar um, este script passa a gravar em produção sem avisar.
 *
 * POR QUE `SET LOCAL ROLE authenticated` + `request.jwt.claims`:
 *   get_admin_analytics_v2 abre com `IF NOT public.is_admin() THEN RAISE
 *   EXCEPTION`, e is_admin() só devolve true de graça quando
 *   `current_setting('role')` já é 'postgres' ou 'service_role' — o que NÃO
 *   é o caso aqui: a DATABASE_URL conecta como `postgres`, mas a sessão
 *   nasce com `role = none` (medido em 20/08/2026), então o atalho não
 *   dispara e a chamada direta falha com "Acesso negado". A saída, igual ao
 *   db-prove-admin-090.cjs, é assumir o papel `authenticated` com um claim
 *   de admin — is_admin() aceita isso no segundo caminho (JWT claims).
 *   `GRANT EXECUTE ... TO authenticated` já existe (v25), então não precisa
 *   de nada além do claim.
 *
 * A CONEXÃO ABRE EM MODO SOMENTE LEITURA (aviso da tarefa): por isso o script
 * roda `SET default_transaction_read_only = off` antes do BEGIN. Medido em
 * 20/08/2026 nesta sessão a flag já estava 'off' — mas a instrução da tarefa
 * é explícita e não custa nada manter, porque não dá pra saber se a conexão
 * de quem rodar isso depois nasce da mesma forma.
 *
 * OS CASOS:
 *   1. Chama a função ANTES da migration (comportamento hoje em produção) e
 *      guarda o JSON — usado para a comparação de chaves do caso 5 e para o
 *      relatório de números antes/depois.
 *   2. Aplica o corpo da migration DENTRO da transação.
 *   3. Chama a função DEPOIS da migration, sem pedido de teste nenhum
 *      (baseline pós-migration).
 *   4. Insere um pedido de teste status='pending', payment_status='aguardando',
 *      total=999, criado agora — o pedido do defeito 1: cobrança nunca paga,
 *      dentro da janela de 30 minutos.
 *   5. Chama a função DEPOIS da migration, COM o pedido de teste, e confere
 *      que today.revenue NÃO mudou entre os casos 3 e 5 — é o defeito 1
 *      fechado: dinheiro que nunca foi pago parou de contar.
 *   6. Confere deliveredTotal = 3 e paidOnCancelled = 1 (defeitos 2 e 3).
 *   7. Insere um SEGUNDO pedido de teste, payment_status='pago' +
 *      status='cancelled' — a porta 'b' do defeito 3 (admin cancela um
 *      pedido que já estava pago; OrderDetail.tsx:159-161 libera o botão de
 *      cancelar para qualquer pedido que não seja 'cancelled' nem
 *      'delivered', inclusive um 'pago'). Confere que paidOnCancelled sobe
 *      de 1 para 2. Sem este caso, a ampliação de payment_status='pago_apos_expirar'
 *      para IN ('pago','pago_apos_expirar') não está provada — com a regra
 *      antiga este caso ficaria parado em 1 (vermelho).
 *   8. Confere que toda chave que existia no JSON do caso 1 continua existindo
 *      no JSON do caso 5 — nenhuma pode ter sumido.
 *   9. ROLLBACK. Fora da transação: confirma que a função voltou a ser a
 *      antiga (sem 'deliveredTotal' no corpo) e que os pedidos de teste
 *      sumiram.
 *
 * USO:  node scripts/db-prove-analitico-dinheiro-real.cjs
 * Sai com código 0 só se todas as asserções passarem.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATION = path.join(
  PROJECT_ROOT,
  "supabase",
  "migrations",
  "20260822000100_analitico_conta_so_dinheiro_reconhecido.sql",
);

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // O caminho vem de PROJECT_ROOT + uma das duas strings literais acima.
    // Nada aqui é entrada de usuário, então o alerta é falso positivo.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const conteudo = fs.readFileSync(caminho, "utf8");
    const linha = conteudo
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada.");
}

let passou = 0;
let falhou = 0;

function conferir(nome, condicao, detalhe) {
  if (condicao) {
    passou++;
    console.log(`  ok    ${nome}`);
  } else {
    falhou++;
    console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

/** Chama get_admin_analytics_v2 assumindo o papel authenticated + claim de
 * admin, e devolve o papel a postgres logo depois — quem chama continua
 * podendo aplicar DDL e fazer INSERT sem restrição de RLS. */
async function chamarComoAdmin(client, days) {
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({
      sub: "00000000-0000-0000-0000-000000000000",
      role: "authenticated",
      app_metadata: { role: "admin" },
    }),
  ]);
  const { rows } = await client.query(
    "SELECT public.get_admin_analytics_v2($1) AS j",
    [days],
  );
  await client.query("RESET ROLE");
  return rows[0].j;
}

async function inserirPedidoTeste(client) {
  const { rows } = await client.query(
    `INSERT INTO public.marketplace_orders
       (customer_name, customer_data, status, total, subtotal, payment_status, created_at)
     VALUES
       ('PROVA ANALITICO-DINHEIRO-REAL', '{}'::jsonb, 'pending', 999, 999, 'aguardando', now())
     RETURNING id`,
  );
  return rows[0].id;
}

/** A porta 'b' do defeito 3: admin cancela, na ficha do pedido, um pedido
 * que já estava payment_status='pago' (OrderDetail.tsx:159-161 libera o
 * botão de cancelar para qualquer pedido que não seja 'cancelled' nem
 * 'delivered', inclusive um já pago). Mesmo customer_name da outra linha de
 * teste, de propósito: a checagem final de limpeza do banco já cobre as
 * duas com uma única contagem. */
async function inserirPedidoPagoCancelado(client) {
  const { rows } = await client.query(
    `INSERT INTO public.marketplace_orders
       (customer_name, customer_data, status, total, subtotal, payment_status, created_at)
     VALUES
       ('PROVA ANALITICO-DINHEIRO-REAL', '{}'::jsonb, 'cancelled', 150, 150, 'pago', now())
     RETURNING id`,
  );
  return rows[0].id;
}

async function main() {
  // MIGRATION é constante de módulo, montada de __dirname. Falso positivo.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(MIGRATION))
    throw new Error(`Migration não encontrada: ${MIGRATION}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const migrationSql = fs.readFileSync(MIGRATION, "utf8");

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log(
    "Nada será comitado: tudo roda numa transação que termina em ROLLBACK.\n",
  );

  await client.query("SET default_transaction_read_only = off");
  await client.query("BEGIN");

  let testOrderId;

  try {
    console.log("=== 1. Função ANTES da migration ===");
    const antes = await chamarComoAdmin(client, 30);
    console.log("today:", JSON.stringify(antes.today));
    console.log("executive:", JSON.stringify(antes.executive));

    console.log("\n=== 2. Migration aplicada (dentro da transação) ===");
    // A mesma trava que o script irmao (db-prove-status-nao-nulo.cjs:204) ja
    // tinha, e que faltava aqui. O cabecalho deste arquivo AVISA do perigo e
    // nao se defendia dele: um `COMMIT;` embutido na migration encerra esta
    // transacao, o ROLLBACK do `finally` vira aviso inocuo, e a redefinicao
    // de get_admin_analytics_v2 fica GRAVADA. Achado da re-revisao de
    // 20/08/2026, que provou o mecanismo em tabela temporaria. Assimetria
    // entre dois scripts gemeos e' o que faz alguem confiar no errado.
    if (/^\s*(BEGIN|COMMIT)\s*;/im.test(migrationSql)) {
      throw new Error(
        `${MIGRATION} tem BEGIN/COMMIT embutido: o ROLLBACK desta prova viraria no-op e a mudanca ficaria gravada. Abortando.`,
      );
    }
    await client.query(migrationSql);

    console.log("\n=== 3. Função DEPOIS da migration, sem pedido de teste ===");
    const depoisSemPedido = await chamarComoAdmin(client, 30);
    console.log("today:", JSON.stringify(depoisSemPedido.today));

    console.log(
      "\n=== 4. Insere pedido de teste (pending + aguardando + total 999) ===",
    );
    testOrderId = await inserirPedidoTeste(client);
    console.log("id:", testOrderId);

    console.log(
      "\n=== 5. Função DEPOIS da migration, COM o pedido de teste ===",
    );
    const depoisComPedido = await chamarComoAdmin(client, 30);
    console.log("today:", JSON.stringify(depoisComPedido.today));

    conferir(
      "today.revenue não se mexe com o pedido pending+aguardando (defeito 1 fechado)",
      depoisSemPedido.today.revenue === depoisComPedido.today.revenue,
      `sem pedido: ${depoisSemPedido.today.revenue}, com pedido: ${depoisComPedido.today.revenue}`,
    );
    conferir(
      "today.count também não se mexe com o pedido de teste",
      depoisSemPedido.today.count === depoisComPedido.today.count,
      `sem pedido: ${depoisSemPedido.today.count}, com pedido: ${depoisComPedido.today.count}`,
    );

    // Asserções por DELTA, não por valor absoluto. Antes eram `=== 3` e
    // `=== 1`, cravados no conteúdo do banco de hoje: marcar um pedido como
    // entregue pela tela — ação normal de desenvolvimento — deixava estes
    // casos vermelhos por DADO, não por código, e quem reencontrasse isso
    // suspeitaria da migration. Achado da re-revisão de 20/08/2026.
    //
    // O que estes dois casos precisam provar é que os campos EXISTEM e são
    // contagem coerente; quem prova a regra é o caso 7, e ele também virou
    // delta.
    console.log("\n=== 6. deliveredTotal e paidOnCancelled ===");
    const entreguesNoBanco = Number(
      (
        await client.query(
          "SELECT COUNT(*)::int AS n FROM public.marketplace_orders WHERE status = 'delivered'",
        )
      ).rows[0].n,
    );
    const presosNoBanco = Number(
      (
        await client.query(
          "SELECT COUNT(*)::int AS n FROM public.marketplace_orders WHERE payment_status IN ('pago','pago_apos_expirar') AND status = 'cancelled'",
        )
      ).rows[0].n,
    );
    conferir(
      `deliveredTotal espelha o banco (${entreguesNoBanco})`,
      depoisComPedido.deliveredTotal === entreguesNoBanco,
      `veio ${depoisComPedido.deliveredTotal}, banco tem ${entreguesNoBanco}`,
    );
    conferir(
      `paidOnCancelled espelha o banco (${presosNoBanco})`,
      depoisComPedido.paidOnCancelled === presosNoBanco,
      `veio ${depoisComPedido.paidOnCancelled}, banco tem ${presosNoBanco}`,
    );

    console.log(
      "\n=== 7. Insere pedido pago+cancelado pelo admin (porta 'b' do defeito 3) ===",
    );
    const idPagoCancelado = await inserirPedidoPagoCancelado(client);
    console.log("id:", idPagoCancelado);
    const depoisComPagoCancelado = await chamarComoAdmin(client, 30);
    conferir(
      "paidOnCancelled sobe exatamente 1 com o pedido pago+cancelado (ampliação para payment_status='pago' provada)",
      depoisComPagoCancelado.paidOnCancelled ===
        depoisComPedido.paidOnCancelled + 1,
      `antes ${depoisComPedido.paidOnCancelled}, depois ${depoisComPagoCancelado.paidOnCancelled}`,
    );

    console.log("\n=== 8. Nenhuma chave do JSON sumiu ===");
    const chavesAntes = Object.keys(antes);
    const chavesDepois = Object.keys(depoisComPedido);
    const sumiram = chavesAntes.filter((k) => !chavesDepois.includes(k));
    conferir(
      "toda chave que existia antes continua existindo depois",
      sumiram.length === 0,
      `sumiram: ${JSON.stringify(sumiram)}`,
    );
    console.log("chaves antes:", JSON.stringify(chavesAntes));
    console.log("chaves depois:", JSON.stringify(chavesDepois));

    console.log(
      "\n=== Números antes/depois (executive, sem recorte de data) ===",
    );
    console.log(
      `totalRevenue: antes=${antes.executive.totalRevenue} depois=${depoisComPedido.executive.totalRevenue}`,
    );
    console.log(
      `totalOrders: antes=${antes.executive.totalOrders} depois=${depoisComPedido.executive.totalOrders}`,
    );
    console.log(
      `avgTicket: antes=${antes.executive.avgTicket} depois=${depoisComPedido.executive.avgTicket}`,
    );
    console.log(
      `activeCustomers: antes=${antes.executive.activeCustomers} depois=${depoisComPedido.executive.activeCustomers}`,
    );
    conferir(
      "totalRevenue não mudou (não há hoje pedido não-cancelado com cobrança pendente)",
      antes.executive.totalRevenue === depoisComPedido.executive.totalRevenue,
      `antes ${antes.executive.totalRevenue}, depois ${depoisComPedido.executive.totalRevenue}`,
    );
    conferir(
      "totalOrders não mudou",
      antes.executive.totalOrders === depoisComPedido.executive.totalOrders,
      `antes ${antes.executive.totalOrders}, depois ${depoisComPedido.executive.totalOrders}`,
    );
    conferir(
      "avgTicket não mudou",
      antes.executive.avgTicket === depoisComPedido.executive.avgTicket,
      `antes ${antes.executive.avgTicket}, depois ${depoisComPedido.executive.avgTicket}`,
    );
    conferir(
      "activeCustomers não mudou",
      antes.executive.activeCustomers ===
        depoisComPedido.executive.activeCustomers,
      `antes ${antes.executive.activeCustomers}, depois ${depoisComPedido.executive.activeCustomers}`,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }

  console.log(
    "\n=== 9. Fora da transação: a migration realmente não foi gravada ===",
  );
  const defDepoisDoRollback = await client.query(
    `SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'get_admin_analytics_v2'`,
  );
  conferir(
    "a função voltou a ser a antiga (sem 'deliveredTotal' no corpo)",
    !defDepoisDoRollback.rows[0].def.includes("deliveredTotal"),
  );

  const pedidoAindaExiste = await client.query(
    `SELECT COUNT(*) AS n FROM public.marketplace_orders
      WHERE customer_name = 'PROVA ANALITICO-DINHEIRO-REAL'`,
  );
  conferir(
    "os dois pedidos de teste sumiram (ROLLBACK desfez os INSERTs)",
    Number(pedidoAindaExiste.rows[0].n) === 0,
    `contagem encontrada: ${pedidoAindaExiste.rows[0].n}`,
  );

  await client.end();

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
