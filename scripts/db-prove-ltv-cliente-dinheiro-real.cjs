#!/usr/bin/env node
/**
 * Prova a migration 20260823000000_ltv_do_cliente_conta_so_dinheiro_reconhecido.sql
 * (auditoria do painel, achado 17) sem gravar nada no banco.
 *
 * TUDO roda em UMA transação terminada em ROLLBACK. Nada é gravado — nem os
 * pedidos de teste, nem o CREATE OR REPLACE da função. Isso só é verdade
 * porque a migration NÃO tem BEGIN/COMMIT embutido: se alguém acrescentar um,
 * este script passa a gravar de verdade sem avisar (por isso a checagem logo
 * abaixo, antes de aplicar).
 *
 * `RESET ALL` primeiro: a DATABASE_URL aponta para o pooler (porta 6543), que
 * reaproveita conexão entre programas — um `SET SESSION` de outro script
 * gruda na conexão e vaza para este. Nunca usamos `SET SESSION` aqui; mesmo
 * assim o RESET ALL protege contra o que outro script possa ter deixado.
 *
 * A CONEXÃO PODE ABRIR EM MODO SOMENTE LEITURA (mesma armadilha do script
 * irmão de analytics): por isso `SET default_transaction_read_only = off`
 * antes do BEGIN — este script PRECISA escrever pedido de teste dentro da
 * transação, então `BEGIN READ ONLY` não serve aqui.
 *
 * POR QUE `SET LOCAL ROLE authenticated` + `request.jwt.claims`:
 *   get_admin_customers_paged abre com `IF NOT public.is_admin() THEN RAISE
 *   EXCEPTION`, e is_admin() só devolve true de graça quando `role` já é
 *   'postgres'/'service_role' — não é o caso da DATABASE_URL usada aqui
 *   (conecta como `postgres`, mas a sessão nasce com role=none). A saída,
 *   igual ao db-prove-analitico-dinheiro-real.cjs, é assumir o papel
 *   `authenticated` com um claim de admin.
 *
 * CLIENTES REAIS, NÃO INVENTADOS: `profiles.id` tem FK para `auth.users(id)`
 * — não dá para criar um cliente do nada sem passar pelo schema de auth do
 * Supabase. Este script usa dois clientes que JÁ existem no banco de
 * desenvolvimento e insere pedido de teste com o `user_id` deles:
 *
 *   - CLIENTE EXERCITADO: recebe os três pedidos do enunciado (pago,
 *     payment_status nulo, aguardando) e prova a correção por DELTA contra o
 *     próprio histórico dele — nunca por valor absoluto, que dependeria do
 *     estado do banco no dia em que alguém rodar isto.
 *   - CLIENTE DE CONTROLE: escolhido por SQL entre os clientes reais deste
 *     banco por ter ao menos um pedido pago e NENHUM pedido cujo
 *     payment_status caia fora de (NULL, 'pago', 'pago_apos_expirar') entre
 *     os não cancelados/devolvidos. Ele não recebe pedido nenhum de teste —
 *     é o controle negativo: se o `total_spent` dele se mexer só de aplicar
 *     a migration, a correção quebrou algo que já estava certo.
 *
 * OS CASOS:
 *   1. Mede os dois clientes ANTES de qualquer pedido de teste (linha de
 *      base real, com a função ainda não corrigida).
 *   2. Insere os três pedidos de teste no cliente exercitado: pago (100),
 *      payment_status NULO (50, "sem cobrança online" — CONTA por definição
 *      da regra) e aguardando (30, o defeito).
 *   3. Mede o cliente exercitado de novo, AINDA com a função antiga: o
 *      defeito reproduzido — os R$ 180 inteiros (100+50+30) entram na soma.
 *   4. Aplica a migration DENTRO da transação.
 *   5. Mede o cliente exercitado outra vez: só R$ 150 (100+50) — os R$ 30 do
 *      pedido aguardando saem da soma. `orders_count` continua subindo os
 *      MESMOS 3 (a contagem de pedidos não muda nesta correção — só o
 *      dinheiro; ver o cabeçalho da migration).
 *   6. CONTROLE NEGATIVO: mede o cliente de controle de novo. Sem nenhum
 *      pedido de teste nele, `total_spent` e `orders_count` têm de ser
 *      EXATAMENTE os mesmos de antes da migration.
 *   7. Os agregados globais (`stats.global_ltv`, `stats.global_orders`): o
 *      mesmo delta de R$ 150 aparece em `global_ltv` (mesma correção,
 *      aplicada também no agregado sem recorte por cliente), e
 *      `global_orders` sobe os mesmos 3 pedidos antes e depois da migration
 *      (contagem não muda).
 *   8. ROLLBACK. Fora da transação: confirma que a função voltou a ser a
 *      antiga (sem o marcador da correção) e que os pedidos de teste
 *      sumiram.
 *
 * USO:  node scripts/db-prove-ltv-cliente-dinheiro-real.cjs
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
  "20260823000000_ltv_do_cliente_conta_so_dinheiro_reconhecido.sql",
);
const MARCADOR_CORRIGIDO =
  "WHEN o.payment_status IS NULL OR o.payment_status IN ('pago', 'pago_apos_expirar')";
const NOME_PEDIDO_TESTE = "PROVA LTV-DINHEIRO-REAL";

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

/** Chama get_admin_customers_paged assumindo o papel authenticated + claim de
 * admin, e devolve o papel a postgres logo depois — quem chama continua
 * podendo aplicar DDL e fazer INSERT sem restrição de RLS. */
async function chamarComoAdmin(client, search) {
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({
      sub: "00000000-0000-0000-0000-000000000000",
      role: "authenticated",
      app_metadata: { role: "admin" },
    }),
  ]);
  const { rows } = await client.query(
    "SELECT public.get_admin_customers_paged($1, 'created_at', 'desc', 0, 20) AS j",
    [search],
  );
  await client.query("RESET ROLE");
  return rows[0].j;
}

/** Mede o cliente identificado por `search` (o e-mail dele, que é único) e
 * devolve { total_spent, orders_count } — ou lança se ele não aparecer na
 * busca, porque isso quebraria a prova em silêncio. */
async function medirCliente(client, search, userId, rotulo) {
  const j = await chamarComoAdmin(client, search);
  const achado = j.data.find((c) => c.id === userId);
  if (!achado) {
    throw new Error(
      `Cliente ${rotulo} (${userId}) não apareceu na busca "${search}" — ${j.data.length} resultado(s).`,
    );
  }
  return {
    total_spent: Number(achado.total_spent),
    orders_count: Number(achado.orders_count),
    global_ltv: Number(j.stats.global_ltv),
    global_orders: Number(j.stats.global_orders),
  };
}

/** O cliente de controle: todo pedido não cancelado/devolvido dele já é
 * dinheiro reconhecido, e ele tem ao menos um pago — então o total dele NÃO
 * PODE se mexer só de aplicar a correção. */
async function escolherClienteControle(client) {
  const { rows } = await client.query(`
    SELECT o.user_id, u.email
      FROM public.marketplace_orders o
      JOIN auth.users u ON u.id = o.user_id
     WHERE o.status NOT IN ('cancelled', 'returned')
     GROUP BY o.user_id, u.email
    HAVING COUNT(*) FILTER (
             WHERE NOT (o.payment_status IS NULL OR o.payment_status IN ('pago', 'pago_apos_expirar'))
           ) = 0
       AND COUNT(*) FILTER (WHERE o.payment_status IN ('pago', 'pago_apos_expirar')) >= 1
     ORDER BY SUM(o.total::numeric) DESC
     LIMIT 1
  `);
  if (rows.length === 0) {
    throw new Error(
      "Nenhum cliente serve de controle negativo (precisa de ao menos um pedido pago e nenhum pedido com payment_status fora de NULL/pago/pago_apos_expirar). Sem ele a prova não distingue conserto de instrumento quebrado.",
    );
  }
  return rows[0];
}

/** O cliente exercitado: qualquer cliente real DIFERENTE do de controle. */
async function escolherClienteExercitado(client, idControle) {
  const { rows } = await client.query(
    `SELECT p.id, u.email
       FROM public.profiles p
       JOIN auth.users u ON u.id = p.id
      WHERE u.email IS NOT NULL AND p.id <> $1
      ORDER BY p.created_at
      LIMIT 1`,
    [idControle],
  );
  if (rows.length === 0) {
    throw new Error(
      "Nenhum segundo cliente real disponível para ser o cliente exercitado.",
    );
  }
  return rows[0];
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
  await client.query("SET default_transaction_read_only = off");
  await client.query("BEGIN");

  try {
    const controle = await escolherClienteControle(client);
    const exercitado = await escolherClienteExercitado(client, controle.user_id);
    console.log(`Cliente de controle:   ${controle.email}`);
    console.log(`Cliente exercitado:    ${exercitado.email}\n`);

    console.log("=== 1. Linha de base, função ANTES da migration ===");
    const baseExercitado = await medirCliente(
      client,
      exercitado.email,
      exercitado.id,
      "exercitado",
    );
    const baseControle = await medirCliente(
      client,
      controle.email,
      controle.user_id,
      "controle",
    );
    console.log("exercitado:", JSON.stringify(baseExercitado));
    console.log("controle:  ", JSON.stringify(baseControle));

    console.log("\n=== 2. Insere os três pedidos de teste no exercitado ===");
    await inserirPedido(client, {
      userId: exercitado.id,
      status: "delivered",
      paymentStatus: "pago",
      total: 100,
    });
    await inserirPedido(client, {
      userId: exercitado.id,
      status: "delivered",
      paymentStatus: null,
      total: 50,
    });
    await inserirPedido(client, {
      userId: exercitado.id,
      status: "pending",
      paymentStatus: "aguardando",
      total: 30,
    });
    console.log("pago=100, payment_status nulo=50, aguardando=30");

    console.log("\n=== 3. Exercitado, AINDA com a função antiga (defeito) ===");
    const antesComPedidos = await medirCliente(
      client,
      exercitado.email,
      exercitado.id,
      "exercitado",
    );
    console.log(JSON.stringify(antesComPedidos));
    conferir(
      "defeito reproduzido: total_spent soma os R$ 180 inteiros (100+50+30, inclusive o aguardando)",
      antesComPedidos.total_spent === baseExercitado.total_spent + 180,
      `esperado ${baseExercitado.total_spent + 180}, veio ${antesComPedidos.total_spent}`,
    );
    conferir(
      "orders_count subiu os 3 pedidos (contagem não filtra por pagamento, antes ou depois)",
      antesComPedidos.orders_count === baseExercitado.orders_count + 3,
      `esperado ${baseExercitado.orders_count + 3}, veio ${antesComPedidos.orders_count}`,
    );

    console.log("\n=== 4. Aplica a migration (dentro da transação) ===");
    await client.query(migrationSql);
    const defDepois = await client.query(
      `SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'get_admin_customers_paged'`,
    );
    conferir(
      "a função aplicada na transação tem o marcador da correção",
      defDepois.rows[0].def.includes(MARCADOR_CORRIGIDO),
    );

    console.log("\n=== 5. Exercitado, DEPOIS da migration (o conserto) ===");
    const depois = await medirCliente(
      client,
      exercitado.email,
      exercitado.id,
      "exercitado",
    );
    console.log(JSON.stringify(depois));
    conferir(
      "total_spent sobe só R$ 150 (100+50) — o pedido aguardando (30) sai da soma",
      depois.total_spent === baseExercitado.total_spent + 150,
      `esperado ${baseExercitado.total_spent + 150}, veio ${depois.total_spent}`,
    );
    conferir(
      "orders_count continua com os MESMOS 3 pedidos — a correção não mexe na contagem",
      depois.orders_count === baseExercitado.orders_count + 3,
      `esperado ${baseExercitado.orders_count + 3}, veio ${depois.orders_count}`,
    );

    console.log(
      "\n=== 6. CONTROLE NEGATIVO: cliente sem pedido pendente nenhum ===",
    );
    const controleDepois = await medirCliente(
      client,
      controle.email,
      controle.user_id,
      "controle",
    );
    console.log(JSON.stringify(controleDepois));
    conferir(
      "controle: total_spent EXATAMENTE igual antes/depois da migration",
      controleDepois.total_spent === baseControle.total_spent,
      `antes ${baseControle.total_spent}, depois ${controleDepois.total_spent}`,
    );
    conferir(
      "controle: orders_count EXATAMENTE igual antes/depois da migration",
      controleDepois.orders_count === baseControle.orders_count,
      `antes ${baseControle.orders_count}, depois ${controleDepois.orders_count}`,
    );

    console.log("\n=== 7. Agregados globais (stats.global_ltv / global_orders) ===");
    conferir(
      "global_ltv sobe os mesmos R$ 150 do cliente exercitado (mesma correção, sem recorte por cliente)",
      depois.global_ltv === baseExercitado.global_ltv + 150,
      `esperado ${baseExercitado.global_ltv + 150}, veio ${depois.global_ltv}`,
    );
    conferir(
      "global_orders sobe os mesmos 3 pedidos, igual antes e depois da migration (contagem não muda)",
      depois.global_orders === baseExercitado.global_orders + 3 &&
        antesComPedidos.global_orders === baseExercitado.global_orders + 3,
      `antes ${antesComPedidos.global_orders}, depois ${depois.global_orders}, base ${baseExercitado.global_orders}`,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }

  console.log(
    "\n=== 8. Fora da transação: a migration realmente não foi gravada ===",
  );
  const defDepoisDoRollback = await client.query(
    `SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'get_admin_customers_paged'`,
  );
  conferir(
    "a função voltou a ser a antiga (sem o marcador da correção)",
    !defDepoisDoRollback.rows[0].def.includes(MARCADOR_CORRIGIDO),
  );

  const pedidoAindaExiste = await client.query(
    `SELECT COUNT(*) AS n FROM public.marketplace_orders WHERE customer_name = $1`,
    [NOME_PEDIDO_TESTE],
  );
  conferir(
    "os três pedidos de teste sumiram (ROLLBACK desfez os INSERTs)",
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
