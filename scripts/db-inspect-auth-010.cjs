#!/usr/bin/env node
/**
 * Levanta o estado REAL do fluxo de OTP de convidado (AUTH-010, issue #118).
 *
 * NAO ALTERA NADA.
 *
 * POR QUE ANTES DE ESCREVER A MIGRATION:
 *   Esta e a unica issue da 1.0.2 que altera TABELA. `otp_verifications` precisa
 *   ganhar `order_id NOT NULL` e `attempts`, e `SET NOT NULL` sobre linha
 *   existente FALHA. Sem saber quantas linhas existem e o que sao, nao da para
 *   escolher entre limpar os OTPs vigentes ou entrar com DEFAULT e backfill.
 *
 *   E tem uma armadilha registrada: o corpo VIVO de handle_new_otp_verification
 *   aponta para um SEGUNDO projeto Supabase (jvgyjlbjhbfrncwbytls), enquanto o
 *   arquivo do repo (20260708190000_secure_otp_flow.sql:92) aponta para
 *   cafkrminfnokvgjqtkle. Um CREATE OR REPLACE nessa funcao apagaria o
 *   redirecionamento e derrubaria o envio do codigo. Este script confirma o alvo
 *   vivo para que a migration saiba o que NAO tocar.
 *
 * USO:  node scripts/db-inspect-auth-010.cjs
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

  titulo("1. otp_verifications: existe? quais colunas?");
  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable, COALESCE(column_default,'-') AS padrao
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='otp_verifications'
     ORDER BY ordinal_position`);
  if (cols.rows.length === 0) {
    console.log("  A TABELA NAO EXISTE. Tudo abaixo perde o sentido.");
  }
  for (const c of cols.rows) {
    console.log(
      `  ${c.column_name.padEnd(18)} ${c.data_type.padEnd(28)} null=${c.is_nullable.padEnd(3)} default=${c.padrao}`,
    );
  }
  const temOrderId = cols.rows.some((c) => c.column_name === "order_id");
  const temAttempts = cols.rows.some((c) => c.column_name === "attempts");
  console.log(`\n  order_id ja existe? ${temOrderId}`);
  console.log(`  attempts ja existe? ${temAttempts}`);

  titulo("2. Quantas linhas, e o que sao — decide o SET NOT NULL");
  const linhas = await client.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE expires_at < NOW())::int AS expiradas,
           count(*) FILTER (WHERE expires_at >= NOW())::int AS vigentes,
           MIN(created_at)::text AS mais_antiga,
           MAX(created_at)::text AS mais_recente
      FROM public.otp_verifications`);
  const l = linhas.rows[0];
  console.log(`  total     : ${l.total}`);
  console.log(`  expiradas : ${l.expiradas}`);
  console.log(`  VIGENTES  : ${l.vigentes}   <- so estas sao dado util`);
  console.log(`  mais antiga : ${l.mais_antiga}`);
  console.log(`  mais recente: ${l.mais_recente}`);
  if (l.total === 0) {
    console.log(
      "\n  Tabela vazia: SET NOT NULL passa direto, sem decisao a tomar.",
    );
  } else if (l.vigentes === 0) {
    console.log(
      "\n  So ha OTP expirado. Limpar antes do ALTER nao perde nada de util.",
    );
  } else {
    console.log(
      `\n  Ha ${l.vigentes} OTP vigente(s). Limpar invalida codigo que alguem pode estar digitando agora.`,
    );
  }

  titulo("3. Constraints, indices e RLS de otp_verifications");
  const cons = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conrelid = 'public.otp_verifications'::regclass
     ORDER BY conname`);
  for (const c of cons.rows) console.log(`  ${c.conname}: ${c.def}`);
  const idx = await client.query(`
    SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname='public' AND tablename='otp_verifications'`);
  for (const i of idx.rows) console.log(`  ${i.indexname}: ${i.indexdef}`);
  const rls = await client.query(`
    SELECT relrowsecurity AS ligado FROM pg_class
     WHERE oid='public.otp_verifications'::regclass`);
  console.log(`  RLS ligado: ${rls.rows[0].ligado}`);
  const pols = await client.query(`
    SELECT policyname, cmd, roles::text FROM pg_policies
     WHERE schemaname='public' AND tablename='otp_verifications'`);
  if (pols.rows.length === 0) console.log("  (nenhuma policy)");
  for (const p of pols.rows)
    console.log(`  policy ${p.policyname} [${p.cmd}] roles=${p.roles}`);

  titulo("4. Triggers na tabela — o que NAO pode ser tocado");
  const trg = await client.query(`
    SELECT t.tgname, p.proname
      FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgrelid = 'public.otp_verifications'::regclass AND NOT t.tgisinternal`);
  for (const t of trg.rows) console.log(`  ${t.tgname} -> ${t.proname}()`);

  titulo(
    "5. handle_new_otp_verification: para qual projeto ele posta AO VIVO?",
  );
  const h = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='handle_new_otp_verification'`);
  if (h.rows.length === 0) {
    console.log("  a funcao nao existe");
  } else {
    const urls = [
      ...h.rows[0].def.matchAll(
        /https:\/\/([a-z0-9]+)\.functions\.supabase\.co\/(\S+?)'/g,
      ),
    ];
    for (const u of urls)
      console.log(`  posta para projeto ${u[1]}, funcao ${u[2]}`);
    console.log(
      "  (o arquivo do repo diz cafkrminfnokvgjqtkle — se divergir, NAO recriar esta funcao)",
    );
  }

  titulo("6. As duas RPCs do fluxo: corpo vivo e ACL");
  for (const nome of ["generate_order_otp_v1", "get_orders_by_otp_v1"]) {
    const r = await client.query(
      `SELECT p.oid::regprocedure::text AS assinatura, p.prosecdef,
              COALESCE(p.proacl::text,'(sem ACL)') AS acl,
              pg_get_functiondef(p.oid) AS def
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1`,
      [nome],
    );
    console.log(`\n  --- ${nome}: ${r.rowCount} sobrecarga(s) ---`);
    for (const f of r.rows) {
      console.log(`  assinatura: ${f.assinatura}`);
      console.log(`  secdef    : ${f.prosecdef}`);
      console.log(`  acl       : ${f.acl}`);
      console.log(`  usa OR entre canais? ${/\bOR\b/.test(f.def)}`);
      console.log(
        `  tem ILIKE '%' concatenado? ${/ILIKE\s*'%'\s*\|\|/.test(f.def)}`,
      );
      console.log("  --- corpo ---");
      console.log(
        f.def
          .split("\n")
          .map((x) => `    ${x}`)
          .join("\n"),
      );
    }
  }

  await client.end();
  console.log("\nLeitura concluida. Nada foi alterado.");
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
