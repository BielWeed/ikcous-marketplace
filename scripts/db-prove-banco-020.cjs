#!/usr/bin/env node
/**
 * Prova a correção do BANCO-020 (issue #103) sem comitar nada no banco.
 *
 * O QUE ELE FAZ, tudo dentro de UMA transação que termina em ROLLBACK:
 *   1. Fotografa o pg_proc.proacl e o prosecdef de get_category_analytics.
 *   2. ANTES de aplicar: com papel `authenticated` e claims de cliente comum,
 *      chama a RPC. Se ela devolver linhas, o vazamento está confirmado — é o
 *      estado de hoje em produção.
 *   3. Aplica a migration 20260804000000.
 *   4. DEPOIS de aplicar: mesma chamada de cliente comum tem de FALHAR, e a
 *      chamada de admin tem de continuar devolvendo linhas.
 *   5. Refotografa o proacl e compara com o do passo 1.
 *   6. ROLLBACK. O banco fica exatamente como estava.
 *
 * POR QUE O `SET LOCAL ROLE authenticated` É O CORAÇÃO DESTE SCRIPT:
 *   is_admin() começa com `IF current_setting('role', true) IN ('postgres',
 *   'service_role') THEN RETURN true`. A DATABASE_URL conecta como `postgres`.
 *   Sem trocar o papel, is_admin() devolve true, a guarda nunca dispara e o
 *   teste passaria sem provar coisa nenhuma.
 *
 * USO:  node scripts/db-prove-banco-020.cjs
 * Sai com código 0 só se as quatro asserções passarem.
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const { resolverCaminhoMigration } = require("./ler-migration.cjs");
const NOME_DA_MIGRATION =
  "20260804000000_add_is_admin_guard_to_category_analytics.sql";
const MIGRATION = resolverCaminhoMigration(NOME_DA_MIGRATION);

// Range largo o bastante para pegar qualquer pedido já feito na loja.
const INICIO = "2020-01-01T00:00:00Z";
const FIM = "2030-01-01T00:00:00Z";

const CLIENTE_COMUM = JSON.stringify({
  sub: "00000000-0000-4000-8000-000000000001",
  role: "authenticated",
  app_metadata: { role: "authenticated" },
});
const ADMIN = JSON.stringify({
  sub: "00000000-0000-4000-8000-000000000002",
  role: "authenticated",
  app_metadata: { role: "admin" },
});

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
  throw new Error(
    "DATABASE_URL não encontrada (nem no ambiente, nem em .env.local, nem em .env).",
  );
}

async function fotografarFuncao(client) {
  const { rows } = await client.query(`
    SELECT p.oid::regprocedure::text AS assinatura,
           p.prosecdef,
           COALESCE(p.proacl::text, '(sem ACL explícita)') AS acl,
           pg_get_functiondef(p.oid) LIKE '%is_admin%' AS tem_guarda
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_category_analytics'
     ORDER BY p.oid`);
  return rows;
}

/**
 * Chama a RPC com um papel e um conjunto de claims, isolado num savepoint —
 * a exceção esperada aborta a transação, e o savepoint devolve ela ao normal.
 */
async function chamarComo(client, rotulo, claims) {
  await client.query("SAVEPOINT teste");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      claims,
    ]);
    const { rows } = await client.query(
      "SELECT * FROM public.get_category_analytics($1::timestamptz, $2::timestamptz)",
      [INICIO, FIM],
    );
    await client.query("ROLLBACK TO SAVEPOINT teste");
    await client.query("RESET ROLE");
    return { negado: false, linhas: rows.length, rotulo };
  } catch (erro) {
    await client.query("ROLLBACK TO SAVEPOINT teste");
    await client.query("RESET ROLE");
    return { negado: true, mensagem: erro.message, rotulo };
  }
}

async function main() {
  if (!MIGRATION)
    throw new Error(
      `Migration não encontrada (raiz nem _arquivadas): ${NOME_DA_MIGRATION}`,
    );

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log(
    "Nada será comitado: tudo roda numa transação que termina em ROLLBACK.\n",
  );

  const falhas = [];
  await client.query("BEGIN");

  try {
    const antes = await fotografarFuncao(client);
    if (antes.length !== 1) {
      throw new Error(
        `Esperava 1 sobrecarga de get_category_analytics, achei ${antes.length}.`,
      );
    }
    console.log("=== Estado atual no banco ===");
    console.log(`  assinatura : ${antes[0].assinatura}`);
    console.log(`  secdef     : ${antes[0].prosecdef}`);
    console.log(`  acl        : ${antes[0].acl}`);
    console.log(`  tem guarda : ${antes[0].tem_guarda}\n`);

    // 1. O vazamento é real hoje?
    const vazamento = await chamarComo(
      client,
      "cliente comum ANTES",
      CLIENTE_COMUM,
    );
    const provaVazamento = !vazamento.negado;
    console.log("=== 1. O vazamento existe hoje? ===");
    console.log(
      provaVazamento
        ? `  CONFIRMADO  cliente comum leu ${vazamento.linhas} linha(s) de faturamento`
        : `  não reproduziu — a chamada já falhou: ${vazamento.mensagem}`,
    );
    if (!provaVazamento) {
      falhas.push(
        "O vazamento não reproduziu ANTES da migration. Ou alguém já corrigiu por fora, ou o teste não está medindo o que promete — investigue antes de aplicar.",
      );
    }

    // 2. Aplica a migration.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await client.query(fs.readFileSync(MIGRATION, "utf8"));
    console.log("\n=== 2. Migration aplicada (dentro da transação) ===");

    // 3. Cliente comum tem de ser barrado.
    const barrado = await chamarComo(
      client,
      "cliente comum DEPOIS",
      CLIENTE_COMUM,
    );
    console.log("\n=== 3. Cliente comum depois da guarda ===");
    console.log(
      barrado.negado
        ? `  BARRADO  ${barrado.mensagem}`
        : `  FALHOU   ainda leu ${barrado.linhas} linha(s)`,
    );
    if (!barrado.negado)
      falhas.push(
        "Cliente comum continuou lendo o faturamento depois da guarda.",
      );

    // 4. Admin tem de continuar passando.
    const admin = await chamarComo(client, "admin DEPOIS", ADMIN);
    console.log("\n=== 4. Admin depois da guarda ===");
    console.log(
      admin.negado
        ? `  FALHOU   admin foi barrado: ${admin.mensagem}`
        : `  OK       admin leu ${admin.linhas} linha(s)`,
    );
    if (admin.negado)
      falhas.push("O admin foi barrado — o dashboard quebraria.");

    // 5. O ACL sobreviveu ao REPLACE?
    const depois = await fotografarFuncao(client);
    const aclIgual = depois[0]?.acl === antes[0].acl;
    const secdefIgual = depois[0]?.prosecdef === antes[0].prosecdef;
    console.log("\n=== 5. ACL e SECURITY DEFINER preservados? ===");
    console.log(`  acl    antes: ${antes[0].acl}`);
    console.log(`  acl   depois: ${depois[0]?.acl}`);
    console.log(
      `  secdef antes/depois: ${antes[0].prosecdef} / ${depois[0]?.prosecdef}`,
    );
    console.log(
      `  ${aclIgual && secdefIgual ? "OK      idênticos" : "FALHOU  divergiram"}`,
    );
    if (!aclIgual) falhas.push("O proacl mudou depois do REPLACE.");
    if (!secdefIgual) falhas.push("O prosecdef mudou depois do REPLACE.");
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }

  console.log(`\n${"=".repeat(60)}`);
  if (falhas.length === 0) {
    console.log(
      "TUDO PROVADO. Nada foi comitado — rode o db-apply.cjs para valer.",
    );
    process.exit(0);
  }
  console.log("NÃO PROVADO:");
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
