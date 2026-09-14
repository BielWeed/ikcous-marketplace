#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename --
 * Caminhos vêm de argumento de linha de comando ou são resolvidos contra o
 * projeto, mesma convenção de scripts/db-apply.cjs e db-prove-banco-zerado.cjs.
 * Nunca há entrada de rede nem payload de terceiro. */
/* eslint-disable security/detect-object-injection --
 * Índices dinâmicos são chaves de listas FIXAS deste arquivo (nomes de
 * arquivo da própria fila, papéis de fábrica, estados conhecidos). Nunca há
 * payload de terceiro. */
/* eslint-disable security/detect-non-literal-regexp --
 * A única RegExp construída por string nasce de lista fixa deste arquivo
 * (mensagens de provisionamento pg_cron/pg_net), sem entrada externa. */

/**
 * Utilitários compartilhados da frente CI-BANCO (scripts/ci/banco/).
 *
 * Receita herdada de scripts/db-prove-banco-zerado.cjs (ADR 0003): lista da
 * raiz em ordem de timestamp, limpeza de comentário/string/dollar-quote antes
 * de tokenizar, e a regra de ouro desta frente — NUNCA encostar em banco real.
 *
 * A trava de banco real é DUPLA e vive AQUI, no único ponto por onde toda
 * ferramenta da pasta obtém conexão:
 *   1. CI_BANCO_EFEMERO=1 tem de estar no ambiente (o workflow exporta; quem
 *      depura localmente escreve na mão). Sem ela, a ferramenta RECUSA.
 *   2. Host de Supabase gerenciado (*.supabase.co/.com/.net, pooler) RECUSA
 *      mesmo com a variável acima — o endereço desta frente é o service
 *      efêmero do job (localhost do runner).
 * De propósito ESTES scripts NÃO leem .env/.env.local: o db-apply.cjs lê, e a
 * leitura automática é exatamente o caminho por onde uma rodada local "de
 * teste" desceria no banco de desenvolvimento.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROTULO = "ci-banco";

const HOSTS_PROIBIDOS = [
  "supabase.co",
  "supabase.com",
  "supabase.net",
  "pooler.supabase",
];

/** Arquivos que dependem de pg_cron/pg_net — extensões do Supabase que o
 * postgres oficial do CI não traz. Mesma lista (e mesma ressalva) do
 * db-prove-banco-zerado.cjs: a prova não cobre o AGENDAMENTO (cron.job /
 * pg_net), nunca o schema; cada arquivo é PULADO somente se o erro dele for
 * o de provisionamento. Erro qualquer outro continua FALHOU. */
const EXCECOES_DE_PROVISIONAMENTO = {
  "20260807000000_reserva_com_expiracao.sql": REGEX_PROVISIONAMENTO(),
  "20260807000001_agenda_expiracao.sql": REGEX_PROVISIONAMENTO(),
  "20260808000100_reconciliacao.sql": REGEX_PROVISIONAMENTO(),
  "20260823000000_ltv_do_cliente_conta_so_dinheiro_reconhecido.sql":
    REGEX_PROVISIONAMENTO(),
  "20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql":
    REGEX_PROVISIONAMENTO(),
};

function REGEX_PROVISIONAMENTO() {
  // Mensagens que significam "a extensão não existe NESTA bancada", não
  // "a migration está errada": pg_cron só instala no banco postgres no
  // Supabase; no CI a extensão nem existe no image oficial; pg_net idem.
  return new RegExp(
    [
      "can only create extension in database postgres",
      'schema "cron" does not exist',
      "function cron\\.",
      'extension "?(pg_cron|pg_net)"? is not available',
      "could not open extension control file",
    ].join("|"),
    "i",
  );
}

function sair(estado, detalhes) {
  console.log(`\n[${ROTULO}] ${estado}`);
  if (detalhes) console.log(detalhes);
  process.exit(
    { OK: 0, FALHOU: 1, RECUSADO: 2, INDETERMINADO: 5 }[estado] ?? 1,
  );
}

/**
 * DATABASE_URL do banco EFÊMERO, com a trava dupla do cabeçalho. Toda
 * ferramenta desta pasta passa por aqui — nenhuma lê .env.
 */
function lerDatabaseUrlEfemero() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    sair(
      "RECUSADO",
      "DATABASE_URL ausente. Esta frente só recebe endereço de banco EFÊMERO por variável de ambiente (o service do job) — de propósito ela NÃO lê .env/.env.local.",
    );
  }
  if (process.env.CI_BANCO_EFEMERO !== "1") {
    sair(
      "RECUSADO",
      "CI_BANCO_EFEMERO=1 ausente no ambiente. Esta ferramenta só roda contra banco descartável de CI; para depurar localmente, exporte DATABASE_URL do container descartável e CI_BANCO_EFEMERO=1.",
    );
  }
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    sair("RECUSADO", "DATABASE_URL não é uma URL de postgres válida.");
  }
  const proibido = HOSTS_PROIBIDOS.find(
    (h) => host === h || host.endsWith(`.${h}`) || host.includes(h),
  );
  if (proibido) {
    sair(
      "RECUSADO",
      `DATABASE_URL aponta para "${host}" (host gerenciado "${proibido}"). A frente CI-BANCO NUNCA conecta a banco real — só ao service efêmero do job.`,
    );
  }
  return url;
}

/** Os .sql DE MIGRATION da raiz da pasta, em ordem de timestamp — o que um
 * banco zerado (ou o CLI do Supabase) rodaria. Duas regras de convenção,
 * não de gosto:
 *   • entra arquivo com prefixo de timestamp de 13 OU 14 dígitos — 14 é o
 *     padrão geral; 13 existe (o par do estorno, 2026110000000/2026110000100)
 *     e é DE PROPÓSITO: na ordem de string ele cai entre a faixa 2026109* e
 *     a 2026111*, exatamente onde a _REGRAS do mural o encaixou;
 *   • `rollback-manual-*` NUNCA é fila: é SQL de incidente para o SQL Editor.
 *     Entrar no apply de um clone desfaria o conserto da migration irmã (a
 *     1ª rollback-manual da pasta é da 20261024, posterior à prova do ADR
 *     0003 — por isso a prova original mediu 43 arquivos puros).
 * A ordem é a de STRING (sort), a mesma do reconciliador e do db-apply.
 * Subpastas (_arquivadas/) invisíveis por construção (readdirSync
 * não-recursivo, mesma régua do db-prove-banco-zerado.cjs). */
function listarMigrations(pasta) {
  return fs
    .readdirSync(pasta)
    .filter((n) => /^\d{13,14}_/.test(n) && n.endsWith(".sql"))
    .sort()
    .map((n) => path.join(pasta, n));
}

/** É dos arquivos que a ferramenta da casa sabe pular por provisionamento? */
function excecaoDeProvisionamento(nomeArquivo, mensagemDeErro) {
  const excecao = EXCECOES_DE_PROVISIONAMENTO[nomeArquivo];
  return Boolean(excecao?.test(mensagemDeErro || ""));
}

/**
 * UMA passada única, na ordem de leitura: comentários (-- até o fim da linha,
 * barra-estrela até o fechamento), strings '...' com escape '' e
 * dollar-quoting $tag$...$tag$ ficam OPACOS; só o que sobra é código.
 * Adaptada da faseZero de db-prove-banco-zerado.cjs — lá ela guarda a
 * RECUSA de comandos que fogem ao banco da prova; aqui ela alimenta o
 * classificador de idempotência da prova de dupla aplicação.
 */
function codigoSemLiteral(texto) {
  let codigo = "";
  let i = 0;
  while (i < texto.length) {
    const restante = texto.slice(i);
    if (restante.startsWith("--")) {
      const fim = texto.indexOf("\n", i);
      i = fim === -1 ? texto.length : fim; // preserva o \n
      continue;
    }
    if (restante.startsWith("/*")) {
      const fim = texto.indexOf("*/", i + 2);
      i = fim === -1 ? texto.length : fim + 2;
      continue;
    }
    if (texto[i] === "'") {
      codigo += "''";
      i += 1;
      while (i < texto.length) {
        if (texto[i] === "'") {
          if (texto[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (texto[i] === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(restante);
      if (m) {
        const fim = texto.indexOf(m[0], i + m[0].length);
        i = fim === -1 ? texto.length : fim + m[0].length;
        codigo += " ";
        continue;
      }
    }
    codigo += texto[i];
    i += 1;
  }
  return codigo;
}

/** Primeira palavra-chave executável de cada instrução de nível de topo. */
function instrucoesDeNivelDeTopo(texto) {
  return codigoSemLiteral(texto)
    .split(";")
    .map((pedaco) => pedaco.replace(/^\s+/, ""))
    .filter((pedaco) => pedaco.length > 0);
}

/** Anexa o bloco markdown no resumo do job quando roda no Actions; no local,
 * só imprime. Um bloco por ferramenta, com título próprio. */
function anexarAoSummaryDoJob(titulo, markdown) {
  const bloco = `\n### ${titulo}\n\n${markdown.trim()}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, bloco);
  }
  console.log(bloco);
}

module.exports = {
  ROTULO,
  EXCECOES_DE_PROVISIONAMENTO,
  sair,
  lerDatabaseUrlEfemero,
  listarMigrations,
  excecaoDeProvisionamento,
  codigoSemLiteral,
  instrucoesDeNivelDeTopo,
  anexarAoSummaryDoJob,
};
