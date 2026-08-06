#!/usr/bin/env node
/**
 * Confirma que a varredura de expiracao esta agendada no pg_cron
 * (CHECKOUT-010 #109, Task 4 da fase 1).
 *
 * NAO ALTERA NADA. So SELECT em cron.job.
 *
 * POR QUE ESTE SCRIPT EXISTE:
 *   O plano original confirmava o agendamento com um `node -e` de uma linha
 *   so, com aspas aninhadas. Ele quebra no PowerShell do Windows e ja foi
 *   bloqueado pelo classificador de automacao em subagentes desta fase. Este
 *   script substitui aquele Step 3 (e o mesmo comando repetido no PORTAO).
 *
 *   pg_cron nao estava instalado neste banco quando esta migration foi
 *   escrita (06/08/2026, so pg_net v0.19.5). Se a extensao ainda nao tiver
 *   sido ligada, cron.job nem existe — este script tem de dizer isso numa
 *   linha legivel, nao estourar o stack trace do Postgres.
 *
 * USO:  node scripts/db-check-cron-expiracao.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const NOME_JOB = "expirar-pedidos-vencidos";

let Client;
try {
  ({ Client } = require("pg"));
} catch {
  console.error(
    "Pacote 'pg' não encontrado. Instale uma vez com:\n\n  npm i -D pg\n",
  );
  process.exit(1);
}

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
  throw new Error(
    "DATABASE_URL não encontrada (nem no ambiente, nem em .env.local, nem em .env).",
  );
}

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows } = await client.query(
      `SELECT jobname, schedule, active
         FROM cron.job
        WHERE jobname = $1`,
      [NOME_JOB],
    );

    if (rows.length === 0) {
      console.log(
        `Nenhum job '${NOME_JOB}' encontrado em cron.job. A migration foi aplicada?`,
      );
      process.exit(1);
    }

    console.table(rows);
  } catch (erro) {
    // 42P01 = undefined_table: cron.job nao existe, ou seja, a extensao
    // pg_cron ainda nao foi instalada/ligada neste banco.
    if (erro.code === "42P01") {
      console.log(
        "cron.job não existe: a extensão pg_cron ainda não está instalada neste banco.",
      );
      process.exit(1);
    }
    throw erro;
  } finally {
    await client.end();
  }
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
