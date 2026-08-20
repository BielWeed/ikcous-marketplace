#!/usr/bin/env node
/**
 * Prova a migration 20260824000000_cliente_frequente_conta_so_dinheiro_reconhecido.sql
 * (achado de revisão sobre o commit d821611, 24/08/2026) sem gravar nada no banco.
 *
 * TUDO roda em UMA transação terminada em ROLLBACK. Nada é gravado — nem os
 * clientes de push, nem os pedidos de teste, nem o CREATE OR REPLACE da
 * função. Isso só é verdade porque a migration NÃO tem BEGIN/COMMIT embutido:
 * se alguém acrescentar um, este script passa a gravar de verdade sem avisar
 * (por isso a checagem logo abaixo, antes de aplicar).
 *
 * `RESET ALL` primeiro, e NUNCA `SET SESSION`: a DATABASE_URL aponta para o
 * pooler do Supabase (porta 6543), que reaproveita conexão entre programas —
 * um `SET` de escopo de SESSÃO gruda na conexão e vaza para o próximo script
 * que pegar a mesma conexão emprestada do pool. Em particular, NÃO se usa
 * `SET default_transaction_read_only = off` aqui (isso É `SET SESSION` por
 * definição, sem `LOCAL`) — mesmo que a conexão possa abrir em modo somente
 * leitura, o jeito certo de escrever é `BEGIN READ WRITE`, que é escopo de
 * TRANSAÇÃO e desaparece sozinho no COMMIT/ROLLBACK.
 *
 * POR QUE `SET LOCAL ROLE authenticated` + `request.jwt.claims`:
 *   get_segmented_push_targets abre com `IF NOT public.is_admin() THEN RAISE
 *   EXCEPTION`, e is_admin() só devolve true de graça quando `role` já é
 *   'postgres'/'service_role' — não é o caso da DATABASE_URL usada aqui
 *   (conecta como `postgres`, mas a sessão nasce com role=none). A saída,
 *   igual aos scripts irmãos de LTV/analytics, é assumir o papel
 *   `authenticated` com um claim de admin SÓ durante a chamada da função, e
 *   devolver o papel a `postgres` logo depois — porque INSERT em
 *   push_subscriptions/marketplace_orders e o CREATE OR REPLACE da migration
 *   precisam do papel sem restrição de RLS.
 *
 * CLIENTES REAIS, ESCOLHIDOS POR UM CRITÉRIO QUE GARANTE O ESTADO NECESSÁRIO:
 *   `profiles.id` tem FK para `auth.users(id)` — não dá para inventar cliente
 *   do nada. Em vez de pegar "o mais velho" (que depende do estado do banco
 *   no dia), a escolha é por um critério que garante a linha de base que a
 *   prova precisa: três clientes reais, com e-mail, que hoje têm ZERO pedidos
 *   em marketplace_orders. Zero pedidos = zero dinheiro reconhecido, então o
 *   ponto de partida de cada um é sempre R$ 0,00, não importa o dia em que
 *   isto rodar. Cada um recebe um papel:
 *     - POSITIVO: prova que o instrumento enxerga o defeito (controle
 *       positivo). Recebe 1 pedido AGUARDANDO acima do mínimo.
 *     - BORDA: o caso que distingue filtrar no WHERE de filtrar no HAVING —
 *       um pedido PAGO abaixo do mínimo sozinho, e um AGUARDANDO que só faz a
 *       soma cruzar o mínimo se contar.
 *     - CONTROLE: dinheiro 100% reconhecido, acima do mínimo. Tem que
 *       aparecer no segmento 'vip' IDÊNTICO antes e depois da migration —
 *       senão a correção quebrou algo que já estava certo.
 *
 * OS PASSOS:
 *   1. Escolhe os 3 clientes e confirma que nenhum aparece no segmento 'vip'
 *      antes de qualquer pedido de teste (linha de base: zero pedidos, zero
 *      dinheiro).
 *   2. Insere os pedidos de teste nos três.
 *   3. Mede o segmento 'vip' AINDA com a função antiga: positivo aparece
 *      (defeito reproduzido), borda aparece (o aguardando cruzou o mínimo),
 *      controle aparece (dinheiro pago já cruzava o mínimo sozinho).
 *   4. Aplica a migration DENTRO da transação.
 *   5. Mede o segmento 'vip' DEPOIS da migration: positivo sai (conserto),
 *      borda sai (só o pago sozinho não cruza o mínimo — é exatamente o caso
 *      que prova que o filtro está no WHERE do subselect, antes do GROUP BY,
 *      e não seria diferente se estivesse dentro de um CASE no HAVING, mas é
 *      o caso que qualquer filtro colocado no lugar errado (ex.: fora do
 *      subselect) deixaria passar por engano), controle continua (dinheiro
 *      pago não muda).
 *   6. ROLLBACK. Fora da transação: confirma que a função voltou a ser a
 *      antiga (sem o marcador da correção) e que a massa de teste sumiu.
 *
 * USO:  node scripts/db-prove-cliente-frequente-dinheiro-real.cjs
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
  "20260824000000_cliente_frequente_conta_so_dinheiro_reconhecido.sql",
);
const MARCADOR_CORRIGIDO =
  "AND (o.payment_status IS NULL OR o.payment_status IN ('pago', 'pago_apos_expirar'))";
const P_MIN_LTV = 150;
const RUN_ID = Date.now();
const NOME_PEDIDO_TESTE = `PROVA CLIENTE-FREQUENTE-DINHEIRO-REAL ${RUN_ID}`;

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // O caminho vem só de PROJECT_ROOT + uma das duas strings literais acima.
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

/** Chama get_segmented_push_targets('vip', ...) assumindo o papel
 * authenticated + claim de admin, e devolve o papel a postgres logo depois —
 * quem chama continua podendo aplicar DDL e fazer INSERT sem restrição de
 * RLS. Devolve o conjunto de user_id presentes no segmento. */
async function medirSegmentoVip(client) {
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({
      sub: "00000000-0000-0000-0000-000000000000",
      role: "authenticated",
      app_metadata: { role: "admin" },
    }),
  ]);
  const { rows } = await client.query(
    "SELECT user_id FROM public.get_segmented_push_targets('vip', $1, 30)",
    [P_MIN_LTV],
  );
  await client.query("RESET ROLE");
  return new Set(rows.map((r) => r.user_id));
}

/** Três clientes reais com e-mail e ZERO pedidos hoje — o critério garante a
 * linha de base (zero dinheiro) sem depender de "o mais velho" nem de
 * qualquer outro estado que mude com o dia em que isto rodar. */
async function escolherTresClientesSemPedido(client) {
  const { rows } = await client.query(`
    SELECT p.id, u.email
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.id
     WHERE u.email IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM public.marketplace_orders o WHERE o.user_id = p.id
           )
     ORDER BY p.id
     LIMIT 3
  `);
  if (rows.length < 3) {
    throw new Error(
      `Só ${rows.length} cliente(s) real(is) sem pedido — a prova precisa de 3.`,
    );
  }
  return {
    positivo: rows[0],
    borda: rows[1],
    controle: rows[2],
  };
}

async function inserirPushSubscription(client, userId, rotulo) {
  await client.query(
    `INSERT INTO public.push_subscriptions (endpoint, p256dh, auth, user_id)
     VALUES ($1, 'prova-p256dh', 'prova-auth', $2)`,
    [`https://prova.teste/cliente-frequente/${rotulo}/${RUN_ID}`, userId],
  );
}

async function inserirPedido(client, { userId, status, paymentStatus, total }) {
  const { rows } = await client.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, status, total, subtotal, payment_status, created_at)
     VALUES
       ($1, $2, '{}'::jsonb, $3, $4, $4, $5, now())
     RETURNING id`,
    [userId, NOME_PEDIDO_TESTE, status, total, paymentStatus],
  );
  return rows[0].id;
}

async function main() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(MIGRATION))
    throw new Error(`Migration não encontrada: ${MIGRATION}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const migrationSql = fs.readFileSync(MIGRATION, "utf8");
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(migrationSql)) {
    throw new Error(
      `${MIGRATION} tem BEGIN/COMMIT embutido: o ROLLBACK desta prova viraria no-op e a mudança ficaria gravada. Abortando.`,
    );
  }

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log(
    "Nada será comitado: tudo roda numa transação que termina em ROLLBACK.\n",
  );

  await client.query("RESET ALL");
  await client.query("BEGIN READ WRITE");

  try {
    const { positivo, borda, controle } =
      await escolherTresClientesSemPedido(client);
    console.log(`Cliente positivo (defeito):  ${positivo.email}`);
    console.log(`Cliente borda (WHERE/HAVING): ${borda.email}`);
    console.log(`Cliente controle (negativo): ${controle.email}\n`);

    await inserirPushSubscription(client, positivo.id, "positivo");
    await inserirPushSubscription(client, borda.id, "borda");
    await inserirPushSubscription(client, controle.id, "controle");

    console.log("=== 1. Linha de base: nenhum tem pedido, nenhum é vip ===");
    const baseVip = await medirSegmentoVip(client);
    conferir(
      "positivo NÃO está no segmento antes de qualquer pedido",
      !baseVip.has(positivo.id),
    );
    conferir(
      "borda NÃO está no segmento antes de qualquer pedido",
      !baseVip.has(borda.id),
    );
    conferir(
      "controle NÃO está no segmento antes de qualquer pedido",
      !baseVip.has(controle.id),
    );

    console.log("\n=== 2. Insere os pedidos de teste ===");
    await inserirPedido(client, {
      userId: positivo.id,
      status: "pending",
      paymentStatus: "aguardando",
      total: 200,
    });
    console.log("positivo:  1 pedido aguardando de 200 (min é 150)");

    await inserirPedido(client, {
      userId: borda.id,
      status: "delivered",
      paymentStatus: "pago",
      total: 100,
    });
    await inserirPedido(client, {
      userId: borda.id,
      status: "pending",
      paymentStatus: "aguardando",
      total: 100,
    });
    console.log(
      "borda:     1 pedido pago de 100 + 1 aguardando de 100 (só cruza 150 com os dois)",
    );

    await inserirPedido(client, {
      userId: controle.id,
      status: "delivered",
      paymentStatus: "pago",
      total: 200,
    });
    console.log("controle:  1 pedido pago de 200 (min é 150)");

    console.log(
      "\n=== 3. Segmento 'vip', AINDA com a função antiga (defeito) ===",
    );
    const antesDaMigration = await medirSegmentoVip(client);
    conferir(
      "CONTROLE POSITIVO: positivo aparece no segmento (pedido não pago conta na função antiga)",
      antesDaMigration.has(positivo.id),
    );
    conferir(
      "borda aparece no segmento (100 pago + 100 aguardando cruzam 150 na função antiga)",
      antesDaMigration.has(borda.id),
    );
    conferir(
      "controle aparece no segmento (200 pago cruza 150)",
      antesDaMigration.has(controle.id),
    );

    console.log("\n=== 4. Aplica a migration (dentro da transação) ===");
    await client.query(migrationSql);
    const defDepois = await client.query(
      `SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'get_segmented_push_targets'`,
    );
    conferir(
      "a função aplicada na transação tem o marcador da correção",
      defDepois.rows[0].def.includes(MARCADOR_CORRIGIDO),
    );

    console.log(
      "\n=== 5. Segmento 'vip', DEPOIS da migration (o conserto) ===",
    );
    const depoisDaMigration = await medirSegmentoVip(client);
    conferir(
      "O CONSERTO: positivo SAI do segmento (o pedido aguardando deixa de contar)",
      !depoisDaMigration.has(positivo.id),
    );
    conferir(
      "A BORDA: borda SAI do segmento (só o pago, 100, fica abaixo de 150 — prova que o filtro entrou antes do GROUP BY/HAVING)",
      !depoisDaMigration.has(borda.id),
    );
    conferir(
      "CONTROLE NEGATIVO: controle continua no segmento, idêntico a antes (dinheiro 100% pago não muda)",
      depoisDaMigration.has(controle.id),
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }

  console.log(
    "\n=== 6. Fora da transação: a migration realmente não foi gravada ===",
  );
  const defDepoisDoRollback = await client.query(
    `SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'get_segmented_push_targets'`,
  );
  conferir(
    "a função voltou a ser a antiga (sem o marcador da correção)",
    !defDepoisDoRollback.rows[0].def.includes(MARCADOR_CORRIGIDO),
  );

  const pedidoAindaExiste = await client.query(
    "SELECT COUNT(*) AS n FROM public.marketplace_orders WHERE customer_name = $1",
    [NOME_PEDIDO_TESTE],
  );
  conferir(
    "os pedidos de teste sumiram (ROLLBACK desfez os INSERTs)",
    Number(pedidoAindaExiste.rows[0].n) === 0,
    `contagem encontrada: ${pedidoAindaExiste.rows[0].n}`,
  );

  const subscriptionAindaExiste = await client.query(
    "SELECT COUNT(*) AS n FROM public.push_subscriptions WHERE endpoint LIKE $1",
    [`%/${RUN_ID}`],
  );
  conferir(
    "as inscrições de push de teste sumiram (ROLLBACK desfez os INSERTs)",
    Number(subscriptionAindaExiste.rows[0].n) === 0,
    `contagem encontrada: ${subscriptionAindaExiste.rows[0].n}`,
  );

  await client.end();

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
