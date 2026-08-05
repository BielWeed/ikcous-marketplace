#!/usr/bin/env node
/**
 * Levanta o estado REAL do vazamento da coluna `custo` (BANCO-010, issue #119).
 *
 * NAO ALTERA NADA. Só lê, e o pouco que precisa de sessão simulada roda em
 * transação terminada em ROLLBACK.
 *
 * POR QUE ESTE SCRIPT EXISTE ANTES DA MIGRATION:
 *   O desenho da correção depende de coisas que o repositório NAO responde com
 *   confiança, e nesta base o arquivo já divergiu do banco mais de uma vez
 *   (ver #112). Especificamente:
 *
 *   1. `produtos.custo` está concedido a quais papéis, coluna a coluna?
 *   2. `vw_produtos_admin` expõe `custo`? Quem consegue ler a view?
 *      Se qualquer `authenticated` lê a view, revogar a coluna na tabela base
 *      NAO fecha nada — só troca a porta.
 *   3. A view é `security_invoker`? Se for false, ela roda com os privilégios
 *      do dono e ignora tanto o RLS quanto os privilégios de coluna de quem
 *      chama. Isso decide se a correção pode ser um simples REVOKE.
 *   4. O front escreve `custo` (update em produtos, insert em vw_produtos_admin
 *      com `.select()` depois). Um REVOKE de SELECT quebra o RETURNING?
 *
 * O que ele imprime é evidência para desenhar a correção, não um veredito.
 *
 * USO:  node scripts/db-inspect-banco-010.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");

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

const titulo = (t) => console.log(`\n=== ${t} ===`);

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log("Somente leitura. Nada sera alterado.");

  // A primeira rodada nao achou vw_produtos_admin no schema public, mas
  // database.types.ts:1445 tem a view tipada com custo — e esses tipos sao
  // gerados a partir do banco. Antes de concluir que ela sumiu, procurar em
  // TODOS os schemas, e nao so no public.
  titulo("0. Onde estao as relacoes de produtos, em qualquer schema");
  const relacoes = await client.query(`
    SELECT n.nspname AS schema, c.relname AS nome,
           CASE c.relkind WHEN 'r' THEN 'tabela' WHEN 'v' THEN 'view'
                          WHEN 'm' THEN 'view materializada' WHEN 'f' THEN 'foreign table'
                          ELSE c.relkind::text END AS tipo
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname ILIKE '%produto%'
       AND n.nspname NOT IN ('pg_catalog','information_schema')
     ORDER BY n.nspname, c.relname`);
  if (relacoes.rows.length === 0) console.log("  (nada com 'produto' no nome)");
  for (const r of relacoes.rows) {
    console.log(`  ${r.schema}.${r.nome} — ${r.tipo}`);
  }

  titulo("0b. Definicao da view publica, para servir de molde");
  const defs = await client.query(`
    SELECT schemaname, viewname, definition FROM pg_views
     WHERE viewname ILIKE '%produto%' ORDER BY schemaname, viewname`);
  for (const d of defs.rows) {
    console.log(`  --- ${d.schemaname}.${d.viewname} ---`);
    console.log(
      d.definition
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
    );
  }

  titulo("1. Privilegios de coluna em produtos.custo");
  const priv = await client.query(`
    SELECT grantee, privilege_type
      FROM information_schema.column_privileges
     WHERE table_schema='public' AND table_name='produtos' AND column_name='custo'
     ORDER BY grantee, privilege_type`);
  if (priv.rows.length === 0) console.log("  (nenhum privilegio explicito)");
  for (const r of priv.rows)
    console.log(`  ${r.grantee.padEnd(16)} ${r.privilege_type}`);

  titulo(
    "2. Privilegios de TABELA em produtos (o que engloba todas as colunas)",
  );
  const tpriv = await client.query(`
    SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
      FROM information_schema.table_privileges
     WHERE table_schema='public' AND table_name='produtos'
     GROUP BY grantee ORDER BY grantee`);
  for (const r of tpriv.rows)
    console.log(`  ${r.grantee.padEnd(16)} ${r.privs}`);

  titulo("3. RLS e policies em produtos");
  const rls = await client.query(`
    SELECT relrowsecurity AS rls_ligado, relforcerowsecurity AS rls_forcado
      FROM pg_class WHERE oid = 'public.produtos'::regclass`);
  console.log(
    `  RLS ligado: ${rls.rows[0].rls_ligado} | forcado: ${rls.rows[0].rls_forcado}`,
  );
  const pols = await client.query(`
    SELECT policyname, cmd, roles::text, qual, with_check
      FROM pg_policies WHERE schemaname='public' AND tablename='produtos'
     ORDER BY policyname`);
  for (const p of pols.rows) {
    console.log(`  - ${p.policyname} [${p.cmd}] roles=${p.roles}`);
    if (p.qual) console.log(`      USING: ${p.qual}`);
    if (p.with_check) console.log(`      CHECK: ${p.with_check}`);
  }

  titulo("4. As duas views: dono, security_invoker, grants");
  const views = await client.query(`
    SELECT c.relname,
           pg_get_userbyid(c.relowner) AS dono,
           COALESCE(array_to_string(c.reloptions, ', '), '(sem reloptions)') AS opcoes,
           COALESCE(c.relacl::text, '(sem ACL explicita)') AS acl
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN ('vw_produtos_public','vw_produtos_admin')
     ORDER BY c.relname`);
  if (views.rows.length === 0) console.log("  NENHUMA das duas views existe!");
  for (const v of views.rows) {
    console.log(`  ${v.relname}`);
    console.log(`    dono    : ${v.dono}`);
    console.log(
      `    opcoes  : ${v.opcoes}   <- security_invoker aparece aqui, se estiver ligado`,
    );
    console.log(`    acl     : ${v.acl}`);
  }

  titulo("5. As views expoem custo?");
  const cols = await client.query(`
    SELECT table_name, string_agg(column_name, ', ' ORDER BY ordinal_position) AS colunas
      FROM information_schema.columns
     WHERE table_schema='public'
       AND table_name IN ('vw_produtos_public','vw_produtos_admin')
     GROUP BY table_name ORDER BY table_name`);
  for (const c of cols.rows) {
    const tem = /(^|, )custo(,|$)/.test(c.colunas);
    console.log(`  ${c.table_name}: custo ${tem ? "PRESENTE" : "ausente"}`);
    console.log(`    ${c.colunas}`);
  }

  titulo("6. Prova de comportamento: quem consegue ler custo hoje");
  const { rows: users } = await client.query(`
    SELECT id, email, COALESCE(raw_app_meta_data ->> 'role','') AS papel
      FROM auth.users ORDER BY created_at LIMIT 50`);
  const comum = users.find((u) => u.papel !== "admin");
  const admin = users.find((u) => u.papel === "admin");
  if (!comum) throw new Error("Nenhum usuario nao-admin em auth.users.");
  console.log(`  cliente comum: ${comum.email}`);
  console.log(`  admin        : ${admin ? admin.email : "(nenhum)"}`);

  const sondar = async (rotulo, papel, sub, alvo) => {
    await client.query("SAVEPOINT s");
    try {
      await client.query(`SET LOCAL ROLE ${papel}`);
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        sub
          ? JSON.stringify({
              sub,
              role: "authenticated",
              app_metadata: { role: "authenticated" },
            })
          : "",
      ]);
      const r = await client.query(
        `SELECT count(*)::int AS linhas, count(custo)::int AS com_custo FROM public.${alvo}`,
      );
      await client.query("ROLLBACK TO SAVEPOINT s");
      await client.query("RESET ROLE");
      console.log(
        `  ${rotulo.padEnd(34)} ${alvo.padEnd(20)} leu ${r.rows[0].linhas} linha(s), ${r.rows[0].com_custo} com custo preenchido`,
      );
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT s").catch(() => {});
      await client.query("RESET ROLE").catch(() => {});
      console.log(
        `  ${rotulo.padEnd(34)} ${alvo.padEnd(20)} BARRADO: ${e.message}`,
      );
    }
  };

  await client.query("BEGIN");
  for (const alvo of ["produtos", "vw_produtos_admin", "vw_produtos_public"]) {
    await sondar(
      "cliente comum (authenticated)",
      "authenticated",
      comum.id,
      alvo,
    );
  }
  for (const alvo of ["produtos", "vw_produtos_admin", "vw_produtos_public"]) {
    await sondar("visitante (anon)", "anon", null, alvo);
  }
  if (admin) {
    for (const alvo of ["produtos", "vw_produtos_admin"]) {
      await client.query("SAVEPOINT sa");
      try {
        await client.query("SET LOCAL ROLE authenticated");
        await client.query(
          "SELECT set_config('request.jwt.claims', $1, true)",
          [
            JSON.stringify({
              sub: admin.id,
              role: "authenticated",
              app_metadata: { role: "admin" },
            }),
          ],
        );
        const r = await client.query(
          `SELECT count(*)::int AS linhas, count(custo)::int AS com_custo FROM public.${alvo}`,
        );
        await client.query("ROLLBACK TO SAVEPOINT sa");
        await client.query("RESET ROLE");
        console.log(
          `  ${"admin (authenticated)".padEnd(34)} ${alvo.padEnd(20)} leu ${r.rows[0].linhas} linha(s), ${r.rows[0].com_custo} com custo preenchido`,
        );
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT sa").catch(() => {});
        await client.query("RESET ROLE").catch(() => {});
        console.log(
          `  ${"admin (authenticated)".padEnd(34)} ${alvo.padEnd(20)} BARRADO: ${e.message}`,
        );
      }
    }
  }
  await client.query("ROLLBACK");

  await client.end();
  console.log("\nLeitura concluida. Nada foi alterado.");
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
