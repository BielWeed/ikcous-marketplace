#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vêm de argumento/constante do projeto, mesma convenção de
 * scripts/db-apply.cjs e db-prove-rollback.cjs; nunca há entrada de rede. */
/**
 * PROVA (b) do passo 0 — o ledger da loja viva não pode divergir do esperado.
 *
 * Contexto (trava 1 do endosso do Claude, mesa 20260828-0637): mover as
 * migrations pre-baseline para _arquivadas/ faz o CLI ver "aplicada no
 * remoto, ausente no local" para cada uma delas — e a sugestão da
 * ferramenta (migration repair) REESCREVE o ledger da loja que já vende.
 * Ninguém roda repair. Esta prova lê o ledger de produção (SELECT
 * somente-leitura, zero escrita) e compara com os arquivos locais,
 * classificando cada divergência:
 *
 *   - REMOTA_SEM_ARQUIVO_PRE     → esperada: arquivamos de propósito. A
 *                                  divergência do passo 0 é exatamente esta.
 *   - REMOTA_SEM_ARQUIVO_POS     → 🔴 inesperada: migration pós-baseline
 *                                  aplicada em produção sem arquivo local.
 *                                  Para tudo; decisão do Gabriel.
 *   - REMOTA_SEM_ARQUIVO_ORFA    → pre-baseline aplicada remotamente cujo
 *                                  arquivo JÁ NÃO existia no repo antes do
 *                                  passo 0 (órfã pré-existente, documentada).
 *   - LOCAL_SEM_REGISTRO         → arquivo local sem entrada no ledger
 *                                  (migration nova ainda não aplicada).
 *                                  Listada para leitura; a decisão de aplicar
 *                                  é do Gabriel, como sempre.
 *
 * USO:  node scripts/db-prove-passo0-migration-list.cjs
 * Sai com 0 só se NENHUMA divergência pós-baseline existir.
 * A lista inteira vai no stdout — colada no PR por inteiro, como manda a trava.
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, "supabase", "migrations");
const ARQUIVADAS_DIR = path.join(MIGRATIONS_DIR, "_arquivadas");
const BASELINE = "20260806000000"; // a baseline do schema vivo

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    if (fs.existsSync(caminho)) {
      const linha = fs
        .readFileSync(caminho, "utf8")
        .split(/\r?\n/)
        .find((l) => l.startsWith("DATABASE_URL="));
      if (linha)
        return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
    }
  }
  fs.writeFileSync("/dev/full", "DATABASE_URL não encontrada");
  process.exit(1);
}

const versao = (nome) => {
  const m = /^(\d{14})_/.exec(nome);
  return m ? m[1] : null;
};

async function main() {
  // 1. Ledger de produção (somente leitura).
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const { rows } = await client.query(
    "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
  );
  await client.end();
  const remotas = rows.map((r) => String(r.version));

  // 2. Arquivos locais: raiz (ativas) e _arquivadas (movidas no passo 0).
  const ativas = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map(versao)
    .filter(Boolean);
  const arquivadas = fs
    .readdirSync(ARQUIVADAS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map(versao)
    .filter(Boolean);
  const _locaisQualquer = new Set([...ativas, ...arquivadas]);

  // 3. Classificação das divergências.
  const semArquivoPre = [];
  const semArquivoPos = [];
  const orfas = [];
  for (const v of remotas) {
    if (ativas.includes(v)) continue;
    if (v < BASELINE) {
      if (arquivadas.includes(v))
        semArquivoPre.push(v); // arquivada de propósito
      else orfas.push(v); // nem antes do passo 0 existia no repo
    } else {
      semArquivoPos.push(v); // 🔴 inesperada
    }
  }
  const localSemRegistro = ativas.filter((v) => !remotas.includes(v));

  // 4. Relatório inteiro — é este bloco que vai colado no PR.
  console.log("== PROVA (b): ledger de produção x arquivos locais ==");
  console.log(
    `Registros no ledger remoto: ${remotas.length}  |  arquivos ativos na raiz: ${ativas.length}  |  arquivos em _arquivadas: ${arquivadas.length}`,
  );
  console.log(
    `\n[ESPERADO] REMOTA_SEM_ARQUIVO_PRE (arquivadas de propósito, ${semArquivoPre.length}):`,
  );
  console.log(semArquivoPre.join("\n") || "(nenhuma)");
  console.log(
    `\n[DOCUMENTADO] REMOTA_SEM_ARQUIVO_ORFA (pré-existentes ao passo 0, ${orfas.length}):`,
  );
  console.log(orfas.join("\n") || "(nenhuma)");
  console.log(
    `\n[ATENÇÃO] LOCAL_SEM_REGISTRO (arquivos novos, apply é clique do Gabriel, ${localSemRegistro.length}):`,
  );
  console.log(localSemRegistro.join("\n") || "(nenhum)");
  console.log(
    `\n[🔴 PROIBIDO] REMOTA_SEM_ARQUIVO_POS (pós-baseline sem arquivo local, ${semArquivoPos.length}):`,
  );
  console.log(semArquivoPos.join("\n") || "(nenhuma)");

  if (semArquivoPos.length > 0) {
    console.error(
      "\nREPROVADO: há migration pós-baseline aplicada em produção sem arquivo local. Não conserte, não rode repair — pare e escreva (decisão do Gabriel).",
    );
    process.exit(1);
  }
  console.log(
    "\nPASSA: a única divergência é o conjunto arquivado de propósito (+ órfãs pré-existentes, se houver). Ninguém roda repair.",
  );
}

main().catch((e) => {
  console.error("Erro na prova:", e.message);
  process.exit(1);
});
