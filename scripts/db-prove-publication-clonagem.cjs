#!/usr/bin/env node
/**
 * Prova a migration 20261061000000 (publication nasce no repositório, laudo
 * novos ângulos 01/09, B1) sem comitar nada no banco.
 *
 * TUDO roda em UMA transação terminada em ROLLBACK. Nada é gravado. Isso só
 * é verdade porque a migration NÃO tem BEGIN/COMMIT embutido — se alguém
 * acrescentar um, este script passa a gravar em produção sem avisar.
 *
 * O QUE É PROVADO:
 *   1. No banco do molde (as três já são membros, habilitadas à mão — item
 *      44 do diagnóstico): aplicar a migration é NO-OP — continua membro,
 *      sem erro. É a prova da IDEMPOTÊNCIA.
 *   2. A cura da loja clonada: tirar `notificacoes` da publication (o estado
 *      de uma loja recém-nascida rodando só as migrations antigas) e aplicar
 *      o corpo da migration de novo → ela VOLTA a ser membro. É a prova do
 *      CAMINHO DE ADD, que no molde nunca roda por causa dos IF.
 *   3. REPLICA IDENTITY FULL nas três tabelas no fim.
 *
 * ALTER PUBLICATION é transacional (catálogo): o DROP/ADD dentro da
 * transação desfaz com o ROLLBACK final.
 *
 * USO:  node scripts/db-prove-publication-clonagem.cjs
 * Sai com código 0 só se todas as asserções passarem.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.join(__dirname, "..");
const MIGRATION = path.join(
  RAIZ,
  "supabase/migrations/20261061000000_a_publication_nasce_no_repositorio.sql",
);
const TABELAS = [
  "notificacoes",
  "marketplace_orders",
  "marketplace_order_items",
];

let falhas = 0;
function asserir(condicao, rotulo) {
  if (condicao) {
    console.log(`  ✔ ${rotulo}`);
  } else {
    falhas += 1;
    console.error(`  ✘ ${rotulo}`);
  }
}

async function membros(client) {
  const { rows } = await client.query(
    `SELECT tablename FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public'`,
  );
  return new Set(rows.map((r) => r.tablename));
}

async function main() {
  const envPath = path.join(RAIZ, ".env");
  const env = fs.readFileSync(envPath, "utf8");
  const linha = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  const dbUrl = linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const migration = fs.readFileSync(MIGRATION, "utf8");

  try {
    await client.query("BEGIN");

    // 1. Estado do molde hoje + no-op da migration
    let antes = await membros(client);
    const faltandoHoje = TABELAS.filter((t) => !antes.has(t));
    console.log(
      `\n[molde hoje] membros ausentes: ${faltandoHoje.length ? faltandoHoje.join(", ") : "nenhum (habilitado à mão)"}`,
    );
    await client.query(migration);
    let depois = await membros(client);
    asserir(
      TABELAS.every((t) => depois.has(t)),
      "aplicar a migration deixa as três tabelas na publication",
    );

    // 2. Caminho de ADD: simula a loja recém-nascida (sem as adições manuais).
    //    As TRÊS tabelas são derrubadas e readicionadas — os três IFs da
    //    migration exercitados (ajuste da revisão adversária de 01/09: o
    //    caminho de ADD é o único que a loja clonada executa).
    for (const tabela of TABELAS) {
      await client.query(
        `ALTER PUBLICATION supabase_realtime DROP TABLE public.${tabela}`,
      );
    }
    depois = await membros(client);
    asserir(
      TABELAS.every((t) => !depois.has(t)),
      "simulei a loja clonada: as três tabelas FORA da publication",
    );

    await client.query(migration);
    depois = await membros(client);
    asserir(
      TABELAS.every((t) => depois.has(t)),
      "a migration recém-aplicada DEVOLVE as três — loja clonada nasce com sino vivo",
    );

    // 3. REPLICA IDENTITY FULL nas três
    const repl = await client.query(
      `SELECT relname, relreplident FROM pg_class
        WHERE oid IN ('public.notificacoes'::regclass,
                      'public.marketplace_orders'::regclass,
                      'public.marketplace_order_items'::regclass)`,
    );
    asserir(
      repl.rows.every((r) => r.relreplident === "f"),
      "REPLICA IDENTITY FULL nas três (o estado que o molde tem na mão)",
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(
    falhas === 0
      ? "\nPROVA COMPLETA: todas as asserções passaram. Nada foi gravado (ROLLBACK)."
      : `\nPROVA REPROVADA: ${falhas} asserção(ões) falharam. NADA foi gravado (ROLLBACK).`,
  );
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("[PROVA FALHOU]", e.message);
  process.exit(1);
});
