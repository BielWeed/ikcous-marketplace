#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename --
 * Caminhos vêm de argumento de linha de comando ou são resolvidos contra o
 * projeto, mesma convenção de scripts/db-apply.cjs e db-prove-banco-zerado.cjs.
 * Nunca há entrada de rede nem payload de terceiro. */

/**
 * CI-BANCO, critério 3: inventário INFORMATIVO dos rollbacks — a ressalva da
 * issue #535 (quem precisa desfazer procura o rollback no lugar ERRADO e só
 * descobre durante o incidente). O job não reprova por isto; o summary do
 * job passa a dizer a verdade sobre onde os rollbacks estão:
 *
 *   1. rollback-manual-*.sql em supabase/migrations/ — para cada um, a
 *      migration irmã existe? Casamento EXATO pelo nome (rollback-manual-
 *      <timestamp>_<nome>.sql ↔ <timestamp>_<nome>.sql) e, quando o nome
 *      diverge, casamento pelo timestamp de 14 dígitos (divergência de nome
 *      é exatamente o tipo de coisa que se procura no lugar errado).
 *   2. Migrations SEM rollback-manual companion — contagem (não é defeito: o
 *      padrão da casa gera rollback para o que redefine função; o resto se
 *      desfaz manual — fica medido, não implícito).
 *   3. Rollback FORA da pasta de migrations (hoje: rollback-*.sql na raiz do
 *      repositório, do período pré-baseline) — a lista de "outros lugares"
 *      onde alguém pode acabar procurando.
 *   4. _arquivadas/ (migrations pré-baseline, histórico não executável) —
 *      contada e marcada como fora da fila.
 *
 * SAÍDA: SEMPRE 0 (informativo) — anexa o relatório ao summary do job.
 *
 * USO: node scripts/ci/banco/inventario-rollback.cjs <pasta-de-migrations>
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { sair, anexarAoSummaryDoJob } = require("./util.cjs");

const PREFIXO_ROLLBACK = "rollback-manual-";
const TS = /^\d{14}/;

function raizDoRepo() {
  return path.resolve(__dirname, "..", "..", "..");
}

function main() {
  const pasta = process.argv[2];
  if (!pasta || !fs.existsSync(pasta)) {
    sair(
      "INDETERMINADO",
      `Uso: node ${path.basename(process.argv[1])} <pasta-de-migrations>`,
    );
  }

  const entradas = fs
    .readdirSync(pasta)
    .filter((n) => n.endsWith(".sql") && !n.startsWith(PREFIXO_ROLLBACK));
  const rollbacks = fs
    .readdirSync(pasta)
    .filter((n) => n.startsWith(PREFIXO_ROLLBACK) && n.endsWith(".sql"));

  const nomeMigrationPorTs = new Map();
  for (const m of entradas) {
    const ts = TS.exec(m)?.[0];
    if (ts && !nomeMigrationPorTs.has(ts)) nomeMigrationPorTs.set(ts, m);
  }

  const casadosExato = [];
  const casadosPorTimestamp = [];
  const orfaos = [];
  for (const r of rollbacks) {
    const base = r.slice(PREFIXO_ROLLBACK.length);
    if (entradas.includes(base)) {
      casadosExato.push(r);
      continue;
    }
    const ts = TS.exec(base)?.[0];
    if (ts && nomeMigrationPorTs.has(ts)) {
      casadosPorTimestamp.push(
        `${r} ↔ ${nomeMigrationPorTs.get(ts)} (NOME DIVERGE do arquivo irmão)`,
      );
      continue;
    }
    orfaos.push(r);
  }

  const semCompanion = entradas.filter(
    (m) => !rollbacks.includes(PREFIXO_ROLLBACK + m),
  );

  // "Outros lugares" — rollback solto fora da fila de migrations.
  const naRaiz = fs
    .readdirSync(raizDoRepo())
    .filter((n) => /^rollback-/.test(n) && n.endsWith(".sql"));
  const pastaArquivadas = path.join(pasta, "_arquivadas");
  const nasArquivadas = fs.existsSync(pastaArquivadas)
    ? fs
        .readdirSync(pastaArquivadas)
        .filter((n) => n.startsWith(PREFIXO_ROLLBACK) && n.endsWith(".sql"))
        .length
    : 0;

  const linhas = [
    `**${rollbacks.length}** \`rollback-manual-*\` na fila · casamento exato: **${casadosExato.length}** · nome diverge (casou por timestamp): **${casadosPorTimestamp.length}** · sem migration irmã: **${orfaos.length}**`,
    `**${entradas.length}** migrations na fila · **${semCompanion.length}** sem \`rollback-manual\` companion (o padrão da casa versiona rollback para o que redefine função — o resto se desfaz à mão; medido aqui, não implícito)`,
    `Rollback em OUTRO lugar (a armadilha da #535): **${naRaiz.length}** \`rollback-*\` na raiz do repositório (legado pré-baseline) · **${nasArquivadas}** em \`_arquivadas/\` (histórico não executável)`,
  ];
  if (casadosPorTimestamp.length) {
    linhas.push(
      "",
      "<details><summary>Rollbacks com nome divergente da migration irmã</summary>",
      "",
      "```",
      ...casadosPorTimestamp,
      "```",
      "",
      "</details>",
    );
  }
  if (orfaos.length) {
    linhas.push(
      "",
      "<details><summary>Rollbacks SEM migration irmã (órfãos — conferir à mão)</summary>",
      "",
      "```",
      ...orfaos,
      "```",
      "",
      "</details>",
    );
  }
  if (naRaiz.length) {
    linhas.push(
      "",
      "<details><summary>Arquivos de rollback na RAIZ do repositório (fora da fila)</summary>",
      "",
      "```",
      ...naRaiz,
      "```",
      "",
      "</details>",
    );
  }

  anexarAoSummaryDoJob(
    "CI Banco — inventário de rollback (informativo, ressalva da #535)",
    linhas.join("\n"),
  );
  sair(
    "OK",
    `Inventário de rollback publicado no summary: ${rollbacks.length} rollbacks, ${casadosPorTimestamp.length} com nome divergente, ${orfaos.length} órfãos, ${naRaiz.length} na raiz.`,
  );
}

main();
