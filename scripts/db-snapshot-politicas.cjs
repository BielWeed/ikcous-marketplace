#!/usr/bin/env node
/**
 * Fotografa as policies de RLS, os grants e as funcoes de producao (BANCO-040, #40).
 *
 * NAO ALTERA NADA. Só SELECT em catálogo.
 *
 * ISTO NAO E UM BACKUP. Um backup de verdade e `pg_dump`, que neste projeto sai
 * por `supabase db dump` — e esse comando exige Docker, que nao roda na maquina
 * do Gabriel hoje. Enquanto isso nao for resolvido, este script cobre o RISCO
 * ESPECIFICO que trava o trabalho de migration, e so ele.
 *
 * QUAL RISCO:
 *   A BANCO-040 registra que as migrations pendentes executam 190 DROP POLICY
 *   contra 127 CREATE POLICY, sobre um banco com 71 policies vivas. Ou seja, o
 *   modo de falha mais provavel nao e "o banco sumiu" — e "as policies sumiram e
 *   ninguem sabe como elas eram". Backup diario resolve o primeiro. Para o
 *   segundo, o que salva e ter o ANTES escrito, para diferenciar.
 *
 * O QUE ELE GERA:
 *   backups/politicas-<carimbo>.sql — as policies como CREATE POLICY executavel,
 *   mais o estado de RLS por tabela, os grants de tabela e a lista de funcoes
 *   com SECURITY DEFINER. Da para diffar contra uma execucao posterior e da,
 *   no limite, para recriar policy apagada por engano.
 *
 * O QUE ELE NAO COBRE: dados, indices, constraints, tipos, sequences, triggers,
 * extensoes. Para isso e pg_dump, sem substituto.
 *
 * USO:  node scripts/db-snapshot-politicas.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DESTINO = path.join(PROJECT_ROOT, "backups");

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

/** 2026-08-05T23-41-02 — ordenavel e valido como nome de arquivo no Windows. */
const carimbo = () =>
  new Date().toISOString().replace(/\..+$/, "").replace(/:/g, "-");

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const partes = [];
  const agora = new Date().toISOString();

  partes.push(
    "-- Snapshot de policies, grants e funcoes — gerado por",
    "-- scripts/db-snapshot-politicas.cjs (BANCO-040, #40).",
    `-- Lido de producao em ${agora}.`,
    "--",
    "-- ISTO NAO E UM BACKUP COMPLETO. Nao tem dados, indices, constraints,",
    "-- triggers nem sequences. Para isso: supabase db dump (exige Docker).",
    "",
  );

  try {
    // --- RLS por tabela --------------------------------------------------
    const rls = await client.query(`
      SELECT c.relname AS tabela,
             c.relrowsecurity  AS rls_ligado,
             c.relforcerowsecurity AS rls_forcado
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `);
    partes.push("-- ===== RLS por tabela =====");
    for (const r of rls.rows) {
      partes.push(
        `-- ${r.tabela}: rls=${r.rls_ligado} force=${r.rls_forcado}`,
      );
    }
    partes.push("");

    // --- Policies como CREATE POLICY executavel ---------------------------
    const pol = await client.query(`
      SELECT schemaname, tablename, policyname, permissive, roles, cmd,
             qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname
    `);

    partes.push(`-- ===== ${pol.rowCount} policies =====`);
    for (const p of pol.rows) {
      const papeis = Array.isArray(p.roles) ? p.roles.join(", ") : p.roles;
      const linhas = [
        `CREATE POLICY ${JSON.stringify(p.policyname)} ON ${p.schemaname}.${p.tablename}`,
        `  AS ${p.permissive === "PERMISSIVE" ? "PERMISSIVE" : "RESTRICTIVE"}`,
        `  FOR ${p.cmd}`,
        `  TO ${papeis}`,
      ];
      if (p.qual) linhas.push(`  USING (${p.qual})`);
      if (p.with_check) linhas.push(`  WITH CHECK (${p.with_check})`);
      partes.push(`${linhas.join("\n")};`, "");
    }

    // --- Grants de tabela -------------------------------------------------
    const grants = await client.query(`
      SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
      GROUP BY table_name, grantee
      ORDER BY table_name, grantee
    `);
    partes.push(`-- ===== ${grants.rowCount} linhas de grant =====`);
    for (const g of grants.rows) {
      partes.push(
        `GRANT ${g.privs} ON public.${g.table_name} TO ${g.grantee};`,
      );
    }
    partes.push("");

    // --- Funcoes SECURITY DEFINER ----------------------------------------
    const fn = await client.query(`
      SELECT p.proname,
             pg_get_function_identity_arguments(p.oid) AS args,
             p.prosecdef AS security_definer
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      ORDER BY p.proname
    `);
    const definers = fn.rows.filter((f) => f.security_definer);
    partes.push(
      `-- ===== ${fn.rowCount} funcoes, ${definers.length} com SECURITY DEFINER =====`,
    );
    for (const f of fn.rows) {
      partes.push(
        `-- ${f.security_definer ? "[DEFINER] " : "           "}${f.proname}(${f.args})`,
      );
    }

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.mkdirSync(DESTINO, { recursive: true });
    const arquivo = path.join(DESTINO, `politicas-${carimbo()}.sql`);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(arquivo, `${partes.join("\n")}\n`, "utf8");

    console.log(`Snapshot gravado em: ${path.relative(PROJECT_ROOT, arquivo)}`);
    console.log(`  tabelas ......... ${rls.rowCount}`);
    console.log(`  policies ........ ${pol.rowCount}`);
    console.log(`  grants .......... ${grants.rowCount}`);
    console.log(
      `  funcoes ......... ${fn.rowCount} (${definers.length} SECURITY DEFINER)`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
