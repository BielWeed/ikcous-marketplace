#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename --
 * Caminhos vêm de argumento de linha de comando ou são resolvidos contra o
 * projeto, mesma convenção de scripts/db-apply.cjs e db-prove-banco-zerado.cjs.
 * Nunca há entrada de rede nem payload de terceiro. */

/**
 * CI-BANCO, prova (c): SEGUNDA passada da raiz inteira sobre o banco que a
 * 1ª passada (aplicar-migrations.cjs) acabou de levantar.
 *
 * O que a frente promete provar, com relatório — não com explosão:
 *   • onde o DESENHO promete idempotência, reaplicar NÃO pode explodir;
 *   • onde NÃO promete, a colisão da 2ª passada é RELATADA (informativo),
 *     porque migration de versão é para rodar uma vez — a ausência da
 *     promessa não é defeito, é estado.
 *
 * "O desenho promete" é lido do PRÓPRIO SQL, instrução por instrução
 * (literal-level: comentário/string/dollar-quote ficam opacos — util.cjs):
 *   PROMETE  = CREATE OR REPLACE · CREATE ... IF NOT EXISTS · DROP ... IF
 *              EXISTS · GRANT/REVOKE · COMMENT ON · ALTER TABLE ... ENABLE/
 *              DISABLE/FORCE ROW LEVEL SECURITY · SET/RESET · controle de
 *              transação (BEGIN/COMMIT/...).
 *   NÃO PROMETE = CREATE TABLE/INDEX/POLICY/TRIGGER sem IF NOT EXISTS,
 *              ALTER TABLE ADD COLUMN/CONSTRAINT, DO block, INSERT/UPDATE/
 *              DELETE — formas que colidem com o próprio resultado na 2ª
 *              rodada por desenho.
 * Um arquivo SÓ promete quando TODAS as instruções prometem. Regra do
 * veredito: arquivo que prometeu e explodiu na 2ª passada = FALHOU (saída 1);
 * arquivo que não prometeu e colidiu = linha do relatório (saída segue 0).
 *
 * Os mesmos arquivos de provisionamento (pg_cron/pg_net — util.cjs) seguem
 * PULADOS com aviso nas duas passadas.
 *
 * USO: node scripts/ci/banco/prova-dupla-aplicacao.cjs <pasta-de-migrations>
 * (rode DEPOIS de aplicar-migrations.cjs, no mesmo banco efêmero)
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  sair,
  lerDatabaseUrlEfemero,
  listarMigrations,
  excecaoDeProvisionamento,
  instrucoesDeNivelDeTopo,
  anexarAoSummaryDoJob,
} = require("./util.cjs");

// Toda instrução cujo RE-RUN é no-op por desenho. âncora no início da
// instrução (o divisor já garante instrução por instrução).
const FORMAS_PROMETIDAS = [
  /^CREATE\s+OR\s+REPLACE\b/i,
  /^CREATE\s+[a-z_][a-z_\s]*\bIF\s+NOT\s+EXISTS\b/i,
  /^DROP\s+[a-z_][a-z_\s]*\bIF\s+EXISTS\b/i,
  /^GRANT\b/i,
  /^REVOKE\b/i,
  /^COMMENT\s+ON\b/i,
  /^ALTER\s+TABLE\s+.+\s(ENABLE|DISABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY$/i,
  /^(SET|RESET)\b/i,
  /^(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|SAVEPOINT|RELEASE\s+SAVEPOINT)\b/i,
];

/** Um arquivo promete idempotência quando TODAS as instruções prometem. */
function prometeIdempotencia(texto) {
  const instrucoes = instrucoesDeNivelDeTopo(texto);
  if (instrucoes.length === 0) return false;
  return instrucoes.every((i) =>
    FORMAS_PROMETIDAS.some((forma) => forma.test(i)),
  );
}

async function main() {
  const pasta = process.argv[2];
  if (!pasta || !fs.existsSync(pasta)) {
    sair(
      "INDETERMINADO",
      `Uso: node ${path.basename(process.argv[1])} <pasta-de-migrations>`,
    );
  }
  const url = lerDatabaseUrlEfemero();
  const arquivos = listarMigrations(pasta);
  if (!arquivos.length) {
    sair("INDETERMINADO", `Nenhum .sql na raiz de ${pasta}`);
  }

  const { Client } = require("pg");
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    sair("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }

  await cliente.query("RESET ALL");

  const limpoNaSegunda = [];
  const colidiuSemPromessa = [];
  const quebrouPromessa = [];
  const pulados = [];
  try {
    for (const arquivo of arquivos) {
      const nome = path.basename(arquivo);
      const texto = fs.readFileSync(arquivo, "utf8");
      const promete = prometeIdempotencia(texto);
      try {
        await cliente.query('SET search_path = "$user", public, extensions');
        await cliente.query(texto);
        limpoNaSegunda.push(nome);
      } catch (erro) {
        await cliente.query("ROLLBACK").catch(() => {});
        if (excecaoDeProvisionamento(nome, erro.message)) {
          pulados.push(nome);
          continue;
        }
        const registro = `${nome} → [${erro.code || "sem código"}] ${erro.message.split("\n")[0].slice(0, 140)}`;
        if (promete) quebrouPromessa.push(registro);
        else colidiuSemPromessa.push(registro);
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }

  const linhas = [
    `**2ª passada: ${limpoNaSegunda.length}/${arquivos.length} reaplicaram limpo.**`,
    `· Prometem idempotência e colidiram: **${quebrouPromessa.length}** (isto SIM é defeito — reprova o job)`,
    `· Não prometem (colisão esperada, relatório): **${colidiuSemPromessa.length}**`,
    `· Pulados por provisionamento (pg_cron/pg_net): **${pulados.length}**`,
  ];
  if (colidiuSemPromessa.length) {
    linhas.push(
      "",
      "<details><summary>Colisões de arquivos que NÃO prometem idempotência (informativo — migration de versão roda uma vez)</summary>",
      "",
      "```",
      ...colidiuSemPromessa,
      "```",
      "",
      "</details>",
    );
  }
  if (quebrouPromessa.length) {
    linhas.push("", "```", ...quebrouPromessa, "```");
  }
  anexarAoSummaryDoJob(
    "CI Banco — prova de dupla aplicação (2ª passada)",
    linhas.join("\n"),
  );

  if (quebrouPromessa.length > 0) {
    sair(
      "FALHOU",
      `${quebrouPromessa.length} arquivo(s) que PROMETEM idempotência (só formas CREATE OR REPLACE / IF NOT EXISTS / DROP IF EXISTS / GRANT…) explodiram na 2ª passada — a promessa do desenho não se cumpre. Veja o relatório acima.`,
    );
  }
  sair(
    "OK",
    `Dupla aplicação provada: ${limpoNaSegunda.length} limpos na 2ª, ${colidiuSemPromessa.length} colisões de quem NÃO promete (relatório), ${pulados.length} pulados.`,
  );
}

main().catch((erro) =>
  sair("INDETERMINADO", erro?.stack ? erro.stack : String(erro)),
);
