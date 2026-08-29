#!/usr/bin/env node
/**
 * Prova a correção do BANCO-010 (issue #119) ANTES de aplicar em produção.
 *
 * Tudo numa transação terminada em ROLLBACK: o banco fica exatamente como
 * estava. Nenhum grant muda, nenhuma view sobra, nenhum produto é criado.
 *
 * O CENÁRIO 6 É O QUE DECIDE SE ESTA MIGRATION PODE SER APLICADA.
 *   `vw_produtos_admin` é dona-executada e guardada por `WHERE public.is_admin()`.
 *   is_admin() começa com `IF current_setting('role') IN ('postgres',
 *   'service_role') THEN RETURN true`. Dentro de uma view que roda com os
 *   privilégios do dono, NAO e obvio se esse GUC continua 'authenticated' ou
 *   vira 'postgres'. Se virar 'postgres', o WHERE é sempre verdadeiro e a view
 *   entrega custo para QUALQUER authenticated — um vazamento pior que o de hoje,
 *   criado pela propria correcao. O cenario 6 mede isso e reprova.
 *
 * OS CENÁRIOS:
 *   Antes
 *     1. cliente comum lê custo em produtos          -> PASSA (é o vazamento)
 *     2. vw_produtos_admin não existe                -> confirma o diagnóstico
 *   Depois
 *     3. cliente comum lê custo em produtos          -> BARRADO
 *     4. cliente comum lê nome/preço em produtos     -> PASSA (vitrine intacta)
 *     5. anônimo lê vw_produtos_public               -> PASSA (vitrine intacta)
 *     6. cliente comum lê vw_produtos_admin          -> 0 LINHAS  <- o critico
 *     7. admin lê custo em vw_produtos_admin         -> linhas com custo
 *     8. admin cadastra produto na view com RETURNING-> PASSA (conserta o erro
 *                                                       do painel hoje)
 *     9. cliente comum tenta cadastrar na view       -> BARRADO
 *    10. admin faz UPDATE em produtos por id         -> PASSA (o WHERE precisa
 *                                                       de SELECT na coluna id)
 *
 * USO:  node scripts/db-prove-banco-010.cjs
 * Sai com código 0 só se os dez cenários passarem.
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const { resolverCaminhoMigration } = require("./ler-migration.cjs");
const NOME_DA_MIGRATION =
  "20260805000000_restore_admin_view_and_hide_custo.sql";
const MIGRATION = resolverCaminhoMigration(NOME_DA_MIGRATION);

const claims = (sub, admin) =>
  sub === null
    ? ""
    : JSON.stringify({
        sub,
        role: "authenticated",
        app_metadata: { role: admin ? "admin" : "authenticated" },
      });

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
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

async function descobrirUsuarios(client) {
  const { rows } = await client.query(
    `SELECT id, email, COALESCE(raw_app_meta_data ->> 'role', '') AS papel
       FROM auth.users ORDER BY created_at LIMIT 50`,
  );
  const cliente = rows.find((u) => u.papel !== "admin");
  const admin = rows.find((u) => u.papel === "admin");
  if (!cliente) throw new Error("Nenhum usuario NAO admin em auth.users.");
  if (!admin) throw new Error("Nenhum usuario admin em auth.users.");
  return { cliente, admin };
}

/**
 * A mesma armadilha da #115: filtrar por raw_app_meta_data nao basta, porque
 * is_admin() tem fallback consultando auth.users. Pergunta ao banco, com o papel
 * e as claims reais, e aborta se o "cliente comum" for admin.
 */
async function conferirNaoAdmin(client, sub, email) {
  await client.query("SAVEPOINT chk");
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    claims(sub, false),
  ]);
  const { rows } = await client.query("SELECT public.is_admin() AS eh");
  await client.query("ROLLBACK TO SAVEPOINT chk");
  await client.query("RESET ROLE");
  if (rows[0].eh) {
    throw new Error(
      `${email} resolve is_admin() = true; nao serve como cliente comum.`,
    );
  }
}

/** Roda um SQL como um papel/claims especifico, isolado num savepoint. */
async function como(client, { papel, sub, admin }, sql, params = []) {
  await client.query("SAVEPOINT c");
  try {
    await client.query(`SET LOCAL ROLE ${papel}`);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      claims(sub, admin),
    ]);
    const r = await client.query(sql, params);
    await client.query("ROLLBACK TO SAVEPOINT c");
    await client.query("RESET ROLE");
    return { ok: true, rows: r.rows, contagem: r.rowCount };
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT c").catch(() => {});
    await client.query("RESET ROLE").catch(() => {});
    return { ok: false, erro: e.message };
  }
}

async function main() {
  if (!MIGRATION)
    throw new Error(`Nao achei (raiz nem _arquivadas): ${NOME_DA_MIGRATION}`);

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log("Nada sera comitado: transacao terminada em ROLLBACK.\n");

  const falhas = [];
  const registrar = (t, ok, detalhe) => {
    console.log(
      `  ${ok ? "OK     " : "FALHOU "} ${t}${detalhe ? ` — ${detalhe}` : ""}`,
    );
    if (!ok) falhas.push(t);
  };

  await client.query("BEGIN");
  try {
    const { cliente, admin } = await descobrirUsuarios(client);
    await conferirNaoAdmin(client, cliente.id, cliente.email);
    console.log(
      `cliente comum: ${cliente.email} (is_admin() = false, conferido)`,
    );
    console.log(`admin        : ${admin.email}\n`);

    const CLIENTE = { papel: "authenticated", sub: cliente.id };
    const ADMIN = { papel: "authenticated", sub: admin.id, admin: true };
    const ANON = { papel: "anon", sub: null };

    console.log("=== ANTES da migration ===");
    const c1 = await como(
      client,
      CLIENTE,
      "SELECT count(custo)::int AS n FROM public.produtos",
    );
    registrar(
      "1. cliente comum le custo em produtos (esperado: PASSA, é o vazamento)",
      c1.ok,
      c1.ok ? `leu custo de ${c1.rows[0].n} produto(s)` : c1.erro,
    );

    const c2 = await como(
      client,
      CLIENTE,
      "SELECT 1 FROM public.vw_produtos_admin LIMIT 1",
    );
    registrar(
      "2. vw_produtos_admin nao existe hoje",
      !c2.ok && /does not exist/i.test(c2.erro || ""),
      c2.ok ? "a view existe — o diagnostico esta errado" : c2.erro,
    );

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await client.query(fs.readFileSync(MIGRATION, "utf8"));
    console.log("\n=== Migration aplicada na transacao ===\n");

    const c3 = await como(
      client,
      CLIENTE,
      "SELECT custo FROM public.produtos LIMIT 1",
    );
    registrar(
      "3. cliente comum le custo em produtos: BARRADO",
      !c3.ok,
      c3.erro,
    );

    const c4 = await como(
      client,
      CLIENTE,
      "SELECT count(*)::int AS n FROM public.produtos WHERE ativo = true",
    );
    registrar(
      "4. cliente comum ainda le a vitrine em produtos: PASSA",
      c4.ok && c4.rows[0].n > 0,
      c4.ok ? `${c4.rows[0].n} produto(s) ativo(s)` : c4.erro,
    );

    const c5 = await como(
      client,
      ANON,
      "SELECT count(*)::int AS n FROM public.vw_produtos_public",
    );
    registrar(
      "5. anonimo ainda le vw_produtos_public: PASSA",
      c5.ok && c5.rows[0].n > 0,
      c5.ok ? `${c5.rows[0].n} produto(s)` : c5.erro,
    );

    // O CRITICO: a view e dona-executada. Se is_admin() enxergar o papel do dono
    // em vez do papel do chamador, ela devolve tudo para qualquer authenticated.
    const c6 = await como(
      client,
      CLIENTE,
      "SELECT count(*)::int AS n FROM public.vw_produtos_admin",
    );
    registrar(
      "6. cliente comum na vw_produtos_admin: 0 LINHAS",
      c6.ok && c6.rows[0].n === 0,
      c6.ok
        ? c6.rows[0].n === 0
          ? "0 linhas, a guarda segurou"
          : `VAZOU ${c6.rows[0].n} linha(s) — is_admin() enxergou o dono, NAO APLIQUE`
        : c6.erro,
    );

    const c7 = await como(
      client,
      ADMIN,
      "SELECT count(*)::int AS n, count(custo)::int AS c FROM public.vw_produtos_admin",
    );
    registrar(
      "7. admin le custo na vw_produtos_admin: PASSA",
      c7.ok && c7.rows[0].c > 0,
      c7.ok ? `${c7.rows[0].n} linha(s), ${c7.rows[0].c} com custo` : c7.erro,
    );

    // Reproduz o insert de useProducts.ts:483, que hoje da
    // "Erro ao processar as modificacoes do produto" no painel.
    const insert = `INSERT INTO public.vw_produtos_admin
        (nome, descricao, preco_venda, custo, estoque, categoria, ativo)
      VALUES ('PROVA BANCO-010 - ROLLBACK', 'teste', 10, 4, 1, 'Geral', false)
      RETURNING id, custo`;
    const c8 = await como(client, ADMIN, insert);
    registrar(
      "8. admin cadastra produto na view, com RETURNING: PASSA",
      c8.ok,
      c8.ok ? `criado, custo retornado = ${c8.rows[0].custo}` : c8.erro,
    );

    const c9 = await como(client, CLIENTE, insert);
    registrar(
      "9. cliente comum tenta cadastrar na view: BARRADO",
      !c9.ok,
      c9.erro,
    );

    const c10 = await como(
      client,
      ADMIN,
      `UPDATE public.produtos SET ativo = ativo
        WHERE id = (SELECT id FROM public.produtos LIMIT 1)`,
    );
    registrar(
      "10. admin faz UPDATE em produtos por id: PASSA",
      c10.ok,
      c10.ok ? "atualizou" : c10.erro,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }

  console.log(`\n${"=".repeat(64)}`);
  if (falhas.length === 0) {
    console.log(
      "TUDO PROVADO. Nada foi comitado — agora sim rode o db-apply.cjs.",
    );
    process.exit(0);
  }
  console.log("NAO PROVADO — nao aplique:");
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
