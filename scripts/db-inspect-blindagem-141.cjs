#!/usr/bin/env node
/**
 * Levanta o estado REAL dos privilégios de ESCRITA em `public.produtos`
 * (BANCO-090, issue #141 — frente blindagem-banco-0409).
 *
 * NÃO ALTERA NADA. Só lê o catálogo.
 *
 * POR QUE ESTE SCRIPT EXISTE ANTES DA MIGRATION:
 *   A issue #141 pede revogar INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER de `anon`
 *   (e TRUNCATE/TRIGGER de `authenticated`) na TABELA produtos. O histórico
 *   desta tabela tinha grants de COLUNA para anon (o BANCO-010 achou
 *   INSERT/REFERENCES/UPDATE de `anon` na coluna `custo` em 05/08 — o
 *   levantamento de 04/09 abaixo mostra que HOJE não sobrou nenhum, nem de
 *   anon nem de PUBLIC). Por cautela a medição de coluna segue no script:
 *   privilégio de coluna FUNCIONA SOZINHO (um INSERT listando só colunas com
 *   grant passa mesmo sem grant de tabela), então "zero grants de coluna" é
 *   pré-condição declarada da prova. (Nota da 3ª revisão: a doc do REVOKE
 *   diz que revogar a TABELA já leva os grants de coluna junto — este olhar
 *   extra é cautela sobre o estado medido, não correção de furo.)
 *
 * O que ele imprime:
 *   1. privilégios de TABELA em produtos (relacl), por papel;
 *   2. privilégios de COLUNA em produtos (attacl), por papel e coluna;
 *   3. RLS + policies (para conferir que a escrita legítima é
 *      authenticated+is_admin e a leitura anônima é a view);
 *   4. owners: quem é dono de produtos e das views (o dono não perde nada).
 *
 * USO:  node scripts/db-inspect-blindagem-141.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado da RAIZ do repo, sem entrada externa
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- idem
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
  console.log("Somente leitura do catálogo. Nada sera alterado.");

  titulo("1. Privilégios de TABELA em public.produtos (relacl)");
  const tabela = await client.query(`
    SELECT coalesce(pg_get_userbyid(nullif(g.grantee, 0)), 'PUBLIC') AS grantee,
           g.privilege_type AS priv
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) g(grantor, grantee, privilege_type, is_grantable)
    WHERE n.nspname = 'public' AND c.relname = 'produtos'
    ORDER BY 1, 2;
  `);
  const porPapelTabela = {};
  for (const r of tabela.rows) {
    porPapelTabela[r.grantee] ??= [];
    porPapelTabela[r.grantee].push(r.priv);
  }
  for (const [papel, privs] of Object.entries(porPapelTabela)) {
    console.log(`  ${papel.padEnd(16)} ${privs.join(", ")}`);
  }

  titulo("2. Privilégios de COLUNA em public.produtos (attacl)");
  const colunas = await client.query(`
    SELECT a.attname AS coluna,
           coalesce(pg_get_userbyid(nullif(g.grantee, 0)), 'PUBLIC') AS grantee,
           g.privilege_type AS priv
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    CROSS JOIN LATERAL aclexplode(a.attacl) g(grantor, grantee, privilege_type, is_grantable)
    WHERE n.nspname = 'public' AND c.relname = 'produtos'
    ORDER BY 2, 1, 3;
  `);
  if (colunas.rows.length === 0) console.log("  (nenhum grant de coluna)");
  for (const r of colunas.rows) {
    console.log(`  ${r.grantee.padEnd(16)} ${r.priv.padEnd(12)} ${r.coluna}`);
  }

  titulo("3. RLS e policies em produtos");
  const rls = await client.query(`
    SELECT relrowsecurity, relforcerowsecurity FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='produtos';
  `);
  console.log(
    `  RLS ligado: ${rls.rows[0].relrowsecurity} | forcado: ${rls.rows[0].relforcerowsecurity}`,
  );
  const policies = await client.query(`
    SELECT policyname, cmd, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname='public' AND tablename='produtos'
    ORDER BY policyname;
  `);
  for (const p of policies.rows) {
    const roles = Array.isArray(p.roles) ? p.roles.join(",") : String(p.roles);
    console.log(`  - ${p.policyname} [${p.cmd}] roles={${roles}}`);
  }

  titulo("4. Donos (dono não perde privilégio, nunca)");
  const owners = await client.query(`
    SELECT c.relname, pg_get_userbyid(c.relowner) AS dono
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('produtos','vw_produtos_public','vw_produtos_admin');
  `);
  for (const o of owners.rows)
    console.log(`  ${o.relname.padEnd(22)} dono: ${o.dono}`);

  await client.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
