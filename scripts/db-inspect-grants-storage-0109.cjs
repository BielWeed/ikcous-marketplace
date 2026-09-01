#!/usr/bin/env node
/**
 * INSPEÇÃO (só leitura) — estado vivo do molde que a migration da onda A
 * (varredura profunda #2) tem de replicar:
 *
 *   1. privileges de COLUNA em public.produtos para anon e authenticated;
 *   2. privileges de TABELA em public.produtos para anon e authenticated;
 *   3. buckets de storage (nome, público);
 *   4. policies de storage.objects (nome, cmd, roles, qualificação).
 *
 * USO: node scripts/db-inspect-grants-storage-0109.cjs   (DATABASE_URL do .env)
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.join(__dirname, "..");

async function main() {
  const envPath = path.join(RAIZ, ".env");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado da RAIZ do repo, sem entrada externa
  const env = fs.readFileSync(envPath, "utf8");
  const linha = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  const dbUrl = linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query("RESET ALL");

    console.log("=== 1. COLUMN privileges em public.produtos ===");
    const colunas = await client.query(
      `SELECT grantee, privilege_type, column_name
         FROM information_schema.column_privileges
        WHERE table_schema = 'public' AND table_name = 'produtos'
          AND grantee IN ('anon', 'authenticated')
        ORDER BY grantee, privilege_type, column_name`,
    );
    const porGrantee = {};
    for (const r of colunas.rows) {
      porGrantee[r.grantee] ??= {};
      porGrantee[r.grantee][r.privilege_type] ??= [];
      porGrantee[r.grantee][r.privilege_type].push(r.column_name);
    }
    console.log(JSON.stringify(porGrantee, null, 2));

    console.log("=== 2. TABLE privileges em public.produtos ===");
    const tabelas = await client.query(
      `SELECT grantee, privilege_type
         FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = 'produtos'
          AND grantee IN ('anon', 'authenticated')
        ORDER BY grantee, privilege_type`,
    );
    console.log(JSON.stringify(tabelas.rows, null, 2));

    console.log("=== 2b. privilégio de COLUNA específico: custo ===");
    for (const papel of ["anon", "authenticated"]) {
      const tem = await client.query(
        `SELECT has_column_privilege($1, 'public.produtos', 'custo', 'SELECT') AS tem`,
        [papel],
      );
      console.log(`${papel} SELECT custo => ${tem.rows[0].tem}`);
    }

    console.log("=== 3. storage.buckets ===");
    const buckets = await client.query(
      `SELECT id, name, public, file_size_limit, allowed_mime_types
         FROM storage.buckets ORDER BY name`,
    );
    console.log(JSON.stringify(buckets.rows, null, 2));

    console.log("=== 4. storage.policies (policies = pg_policies) ===");
    const policies = await client.query(
      `SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
         FROM pg_policies WHERE schemaname = 'storage' ORDER BY tablename, policyname`,
    );
    console.log(JSON.stringify(policies.rows, null, 2));

    console.log("=== 4b. RLS habilitado em storage.objects? ===");
    const rls = await client.query(
      `SELECT relrowsecurity FROM pg_class
        WHERE oid = 'storage.objects'::regclass`,
    );
    console.log(`relrowsecurity = ${rls.rows[0].relrowsecurity}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[INSPEÇÃO FALHOU]", e.message);
  process.exit(1);
});
