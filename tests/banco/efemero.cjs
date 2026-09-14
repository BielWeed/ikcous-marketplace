"use strict";

/**
 * Util compartilhado da suíte tests/banco/ (frente CI-CONTRATO-DINHEIRO).
 *
 * A TRAVA DE BANCO é o contrato deste arquivo: toda conexão daqui passa por
 * lerDatabaseUrlEfemera(), que RECUSA qualquer alvo que não seja o Postgres
 * efêmero do próprio job (CI_BANCO_EFEMERO=1 + host localhost). Dinheiro em
 * teste é dado de FIXTURE; banco real nunca é tocado por esta suíte.
 *
 * A ideia é a mesma da trava de scripts/ci/banco/util.cjs (frente ci-banco,
 * PR #585) — reescrita aqui autocontida para esta frente não depender de
 * arquivo de outra.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O único caminho de arquivo daqui é GITHUB_STEP_SUMMARY (definido pelo
 * próprio Actions), nunca entrada de rede nem de terceiro. */

const fs = require("node:fs");

function falhar(tipo, mensagem) {
  console.error(`\n[${tipo}] ${mensagem}\n`);
  process.exit(1);
}

function lerDatabaseUrlEfemera() {
  const url = process.env.DATABASE_URL || "";
  if (process.env.CI_BANCO_EFEMERO !== "1") {
    falhar(
      "RECUSADO",
      "CI_BANCO_EFEMERO=1 ausente. Esta suíte só roda contra o Postgres efêmero do job de CI (rpc-ci.yml).",
    );
  }
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  if (
    !url.startsWith("postgres://") ||
    (host !== "localhost" && host !== "127.0.0.1")
  ) {
    falhar(
      "RECUSADO",
      `DATABASE_URL fora do efêmero (host '${host || "ilegível"}'). Este job NUNCA aponta para banco real.`,
    );
  }
  return url;
}

function anexarAoSummary(titulo, corpoMarkdown) {
  const caminho = process.env.GITHUB_STEP_SUMMARY;
  if (!caminho) return;
  try {
    fs.appendFileSync(caminho, `\n## ${titulo}\n\n${corpoMarkdown}\n`);
  } catch (erro) {
    console.log(`[summary] não anexei ao summary do job: ${erro.message}`);
  }
}

module.exports = { falhar, lerDatabaseUrlEfemera, anexarAoSummary };
