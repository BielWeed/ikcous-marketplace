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

// Exceção por LISTA FECHADA (medido 07/09/2026): as duas migrations abaixo
// nasceram com versão de 13 dígitos (typo do timestamp na criação), não 14
// como o padrão AAAAMMDDhhmmss_. Já estão registradas no ledger da loja
// principal desde 07/09/2026 — renomear o arquivo criaria uma versão nova
// sem correspondência no ledger (órfã em produção) e editar o ledger está
// fora de cogitação. Por isso a exceção é por NOME EXATO, nunca por abrir a
// regex para "qualquer coisa de 13 dígitos": um nome futuro de 13 dígitos
// fora desta lista tem de continuar caindo em NOME_FORA_DO_PADRAO.
const NOMES_13_DIGITOS_COM_EXCECAO = new Set([
  "2026110000000_o_estorno_nasce_no_ledger.sql",
  "2026110000100_concluir_estorno.sql",
]);

// classificarNome decide, sem tocar disco nem banco, o que um nome de
// arquivo de migration significa para a prova. Três formas de resultado:
//   { versao }                 → versão de 14 dígitos, padrão normal.
//   { versao, excecao: true }  → um dos dois nomes de 13 dígitos acima.
//   { foraDoPadrao: true }     → qualquer outro nome que não case com o
//                                padrão nem esteja na lista fechada.
function classificarNome(nome) {
  const m14 = /^(\d{14})_/.exec(nome);
  if (m14) return { versao: m14[1] };
  if (NOMES_13_DIGITOS_COM_EXCECAO.has(nome)) {
    const m13 = /^(\d{13})_/.exec(nome);
    return { versao: m13[1], excecao: true };
  }
  return { foraDoPadrao: true };
}

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
  // rollback-manual-*.sql (e a família rollback-*.sql) já era ignorada em
  // silêncio antes desta mudança — a regex de 14 dígitos nunca casava com o
  // prefixo "rollback". Mantido exatamente esse comportamento, filtrando
  // ANTES de chamar classificarNome: senão esses arquivos virariam
  // NOME_FORA_DO_PADRAO por engano, e não é essa a classe nova pedida.
  const nomesAtivos = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !/^rollback-/.test(f));
  const classificacoesAtivas = nomesAtivos.map((f) => ({
    nome: f,
    ...classificarNome(f),
  }));
  const foraDoPadrao = classificacoesAtivas
    .filter((c) => c.foraDoPadrao)
    .map((c) => c.nome);
  const ativas = classificacoesAtivas.map((c) => c.versao).filter(Boolean);
  // _arquivadas continua com a leitura antiga: nomes fora do padrão de lá
  // (ex.: favorites_migration.sql, pré-existentes ao passo 0) seguem
  // silenciosamente ignorados — só a raiz de MIGRATIONS_DIR ganha a checagem
  // nova. classificarNome é reaproveitada para não duplicar a regex, mas seu
  // `foraDoPadrao` não é olhado aqui de propósito.
  const arquivadas = fs
    .readdirSync(ARQUIVADAS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => classificarNome(f).versao)
    .filter(Boolean);
  const _locaisQualquer = new Set([...ativas, ...arquivadas]);

  // 3. Classificação das divergências.
  // Exceção declarada (revisão do PR #320, BLOQUEIA 1 do Claude): o backfill
  // 20260807000002 é PÓS-baseline no timestamp mas é operação de dados, não de
  // schema — DML one-shot com contagens hardcoded do banco original
  // ("esperava 13 pedidos e 33 unidades"), sem o que fazer em banco novo. Foi
  // arquivado de propósito para a cadeia limpa passar dele; o ledger de
  // produção o registra como aplicado, e isso é esperado, não divergência.
  // Structuralmente seria REMOTA_SEM_ARQUIVO_POS; semanticamente é benigna.
  const POS_BASELINE_ARQUIVADAS_DE_PROPOSITO = new Set([
    "20260807000002", // backfill_pedidos_abandonados — DML pura, zero DDL
  ]);
  const semArquivoPre = [];
  const semArquivoPos = [];
  const semArquivoPosDeProposito = [];
  const orfas = [];
  for (const v of remotas) {
    if (ativas.includes(v)) continue;
    if (v < BASELINE) {
      if (arquivadas.includes(v))
        semArquivoPre.push(v); // arquivada de propósito
      else orfas.push(v); // nem antes do passo 0 existia no repo
    } else if (
      POS_BASELINE_ARQUIVADAS_DE_PROPOSITO.has(v) &&
      arquivadas.includes(v)
    ) {
      semArquivoPosDeProposito.push(v); // exceção declarada acima
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
    `\n[DECLARADA] REMOTA_SEM_ARQUIVO_POS_ARQUIVADA_DE_PROPOSITO (pós-baseline só-de-dados, motivo no código, ${semArquivoPosDeProposito.length}):`,
  );
  console.log(semArquivoPosDeProposito.join("\n") || "(nenhuma)");
  console.log(
    `\n[ATENÇÃO] LOCAL_SEM_REGISTRO (arquivos novos, apply é clique do Gabriel, ${localSemRegistro.length}):`,
  );
  console.log(localSemRegistro.join("\n") || "(nenhum)");
  console.log(
    `\n[🔴 PROIBIDO] REMOTA_SEM_ARQUIVO_POS (pós-baseline sem arquivo local, ${semArquivoPos.length}):`,
  );
  console.log(semArquivoPos.join("\n") || "(nenhuma)");
  console.log(
    `\n[🔴 PROIBIDO] NOME_FORA_DO_PADRAO (arquivo .sql na raiz de migrations com nome fora do padrão AAAAMMDDhhmmss_ e fora da lista fechada de exceção, ${foraDoPadrao.length}):`,
  );
  console.log(foraDoPadrao.join("\n") || "(nenhum)");

  if (semArquivoPos.length > 0 || foraDoPadrao.length > 0) {
    if (foraDoPadrao.length > 0) {
      console.error(
        `\nREPROVADO: nome fora do padrão AAAAMMDDhhmmss_: ${foraDoPadrao.join(", ")}. Se AINDA NÃO foi aplicado em loja nenhuma, renomeie ANTES de aplicar. Se JÁ está no ledger de alguma loja, NÃO renomeie (viraria órfã lá): acrescente o nome à lista fechada NOMES_13_DIGITOS_COM_EXCECAO neste script.`,
      );
    }
    if (semArquivoPos.length > 0) {
      console.error(
        "\nREPROVADO: há migration pós-baseline aplicada em produção sem arquivo local. Não conserte, não rode repair — pare e escreva (decisão do Gabriel).",
      );
    }
    process.exit(1);
  }
  console.log(
    "\nPASSA: a única divergência é o conjunto arquivado de propósito — as pré-baseline, as órfãs pré-existentes e as pós-baseline só-de-dados declaradas no código. Ninguém roda repair.",
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error("Erro na prova:", e.message);
    process.exit(1);
  });
}

// Exportado para tests/db_prove_passo0_classificar_nome_test.ts. O guarda
// acima existe por causa disso: sem ele, importar o módulo para testar
// classificarNome dispararia a conexão com o banco de produção.
module.exports = { classificarNome };
