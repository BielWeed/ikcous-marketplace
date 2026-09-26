"use strict";

/**
 * Roda UMA prova viva num banco PRÓPRIO, clonado (CREATE DATABASE … TEMPLATE)
 * do banco efêmero recém-migrado — para as provas que medem totais da loja
 * (saldo das contas, número de clientes, KPIs) não enxergarem as fixtures de
 * outra prova que rodou antes no mesmo banco. O clone some no fim.
 *
 * USO (no rpc-ci.yml, ANTES de qualquer prova que escreva no banco base):
 *   node tests/banco/rodar-isolado.cjs tests/banco/financeiro-viva.cjs
 *
 * Mesma trava de sempre: só roda com CI_BANCO_EFEMERO=1 e DATABASE_URL em
 * localhost (efemero.cjs). O banco base não é tocado.
 */

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");

async function comAdmin(urlBase, fn) {
  // Conecta no template1 — o banco base não pode ter sessão aberta enquanto
  // serve de molde.
  const url = new URL(urlBase);
  url.pathname = "/template1";
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end().catch(() => {});
  }
}

async function main() {
  const script = process.argv[2];
  if (!script) falhar("USO", "node tests/banco/rodar-isolado.cjs <prova.cjs>");
  const urlBase = lerDatabaseUrlEfemera();
  const base = new URL(urlBase).pathname.replace(/^\//, "") || "postgres";
  const nome = `prova_${path
    .basename(script, ".cjs")
    .replace(/[^a-z0-9]/gi, "_")
    .toLowerCase()}`;

  await comAdmin(urlBase, async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await admin.query(`CREATE DATABASE "${nome}" TEMPLATE "${base}"`);
  });

  const urlClone = new URL(urlBase);
  urlClone.pathname = `/${nome}`;
  const resultado = spawnSync(process.execPath, [script], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: urlClone.toString() },
  });

  await comAdmin(urlBase, (admin) =>
    admin.query(`DROP DATABASE IF EXISTS "${nome}"`),
  );
  process.exit(resultado.status ?? 1);
}

main().catch((erro) => falhar("INDETERMINADO", erro.message));
