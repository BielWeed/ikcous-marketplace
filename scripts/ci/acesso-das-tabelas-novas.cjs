#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection -- lê só os .sql da pasta de migrations deste repositório (a padrão ou a que o teste passa, sempre local); os índices são posições numéricas do próprio texto lido, nunca chave vinda de fora. */
/**
 * TRAVA ESTÁTICA (26/11/2026): toda migration NOVA que cria tabela em public
 * diz, no MESMO arquivo, quem pode usá-la.
 *
 * POR QUE: desde 30/05/2026 projeto Supabase NOVO nasce sem o `ALTER DEFAULT
 * PRIVILEGES` que dava acesso automático a anon/authenticated/service_role em
 * toda tabela nova de public (changelog oficial; a doc recomenda decisão
 * explícita, GRANT ou REVOKE). As lojas antigas ainda têm a regra, e o
 * instalador da loja nova a reaplica (scripts/ci/banco/privilegios-padrao.cjs)
 * — mas migration que depende dela em silêncio é migration que dá permissões
 * DIFERENTES conforme o banco onde cai. As ~280 migrations de hoje foram
 * escritas assim (a baseline nem tem GRANT) e ficam como estão: a trava vale
 * só para versão DEPOIS do corte abaixo.
 *
 * A REGRA: cada `CREATE TABLE [IF NOT EXISTS] public.X` (ou `X` sem schema,
 * que cai em public pelo search_path; TEMP fica de fora) precisa, no mesmo
 * arquivo, de `GRANT … ON [TABLE] public.X …` OU `REVOKE ALL [PRIVILEGES] ON
 * [TABLE] public.X …` (lista de tabelas vale). Comentário não conta; texto
 * dentro de corpo de função e de DO conta (é SQL que roda).
 *
 * USO: node scripts/ci/acesso-das-tabelas-novas.cjs [pasta]   (sai 1 se achar)
 * No CI quem a aplica é tests/ci_acesso_das_tabelas_novas_test.ts (test:unit),
 * sobre a pasta real.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** A maior versão de 14 dígitos que existia no repositório quando a trava
 * nasceu. Versão MAIOR (ordem de texto = ordem da fila) é nova. */
const CORTE_DE_VERSAO = "20261480000000";
/** As únicas versões de 13 dígitos de antes do corte (posições 83/84 da fila).
 * Qualquer OUTRA de 13 dígitos é nova: comparar 13 com 14 dígitos por número
 * ou por texto deixaria uma nova escapar. */
const VERSOES_ANTIGAS_DE_13_DIGITOS = new Set([
  "2026110000000",
  "2026110000100",
]);

const DA_FILA = /^(\d{13,14})_.*\.sql$/;
const PASTA_PADRAO = path.resolve(__dirname, "../../supabase/migrations");

function ehMigrationNova(arquivo) {
  const m = DA_FILA.exec(arquivo);
  if (!m) return false;
  const versao = m[1];
  if (versao.length === 13) return !VERSOES_ANTIGAS_DE_13_DIGITOS.has(versao);
  return versao > CORTE_DE_VERSAO;
}

/** O texto sem comentários (`--` até o fim da linha e `/* *\/` aninhável),
 * respeitando string ('…', E'…' com barra) e identificador entre aspas. O
 * corpo entre $tag$ é lido como SQL (é o que roda num DO ou numa função). */
function semComentarios(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n" && sql[i] !== "\r") i++;
      out += " ";
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      let profundidade = 1;
      i += 2;
      while (i < n && profundidade > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          profundidade++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          profundidade--;
          i += 2;
        } else i++;
      }
      out += " ";
      continue;
    }
    if (c === "'" || c === '"') {
      const eString =
        c === "'" &&
        /[Ee]/.test(sql[i - 1] ?? "") &&
        !/[A-Za-z0-9_$]/.test(sql[i - 2] ?? "");
      let j = i + 1;
      while (j < n) {
        if (eString && sql[j] === "\\") {
          j += 2;
          continue;
        }
        if (sql[j] === c && sql[j + 1] === c) {
          j += 2;
          continue;
        }
        if (sql[j] === c) {
          j++;
          break;
        }
        j++;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const PARTE = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const NOME = String.raw`${PARTE}(?:\s*\.\s*${PARTE})?`;
// eslint-disable-next-line security/detect-non-literal-regexp -- montada só das constantes PARTE/NOME deste arquivo, nunca de entrada.
const NOME_INTEIRO = new RegExp(String.raw`^\s*(${NOME})\s*$`);
// eslint-disable-next-line security/detect-non-literal-regexp -- idem: só constantes deste arquivo.
const CRIA_TABELA = new RegExp(
  String.raw`\bCREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:(TEMPORARY|TEMP)\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${NOME})`,
  "gi",
);
// eslint-disable-next-line security/detect-unsafe-regex -- quantificadores preguiçosos presos por `;`; a entrada é um .sql local deste repositório (poucos KB), nunca rede.
const CONCEDE = /\bGRANT\s[^;]*?\bON\s+(?:TABLE\s+)?([^;]*?)\s+TO\b/gi;
const FECHA =
  // eslint-disable-next-line security/detect-unsafe-regex -- idem: preso por `;`, entrada local.
  /\bREVOKE\s+ALL(?:\s+PRIVILEGES)?\s+ON\s+(?:TABLE\s+)?([^;]*?)\s+FROM\b/gi;

/** `public.x`, `"Public"."X"`, `x` → `schema.tabela` (sem aspas no não
 * citado, minúsculo como o Postgres; sem schema = public). */
function nomeCanonico(bruto) {
  const partes = [];
  for (const m of bruto.matchAll(
    /"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*)/g,
  )) {
    partes.push(
      m[1] !== undefined ? m[1].replaceAll('""', '"') : m[2].toLowerCase(),
    );
  }
  return partes.length === 1
    ? `public.${partes[0]}`
    : `${partes[0]}.${partes[1]}`;
}

/** Os nomes de uma lista `a, public.b, "c"` (o que não é nome de tabela, como
 * `ALL TABLES IN SCHEMA x` ou `FUNCTION f(int)`, não entra). */
function nomesDaLista(lista) {
  const nomes = [];
  for (const item of lista.split(",")) {
    const m = NOME_INTEIRO.exec(item);
    if (m) nomes.push(nomeCanonico(m[1]));
  }
  return nomes;
}

/** As tabelas de public que o arquivo cria sem GRANT nem REVOKE ALL nelas, em
 * ordem de aparição, sem repetir. */
function tabelasSemDecisao(corpo) {
  const sql = semComentarios(corpo);
  const decididas = new Set();
  for (const re of [CONCEDE, FECHA]) {
    for (const m of sql.matchAll(re)) {
      for (const nome of nomesDaLista(m[1])) decididas.add(nome);
    }
  }
  const faltam = [];
  for (const m of sql.matchAll(CRIA_TABELA)) {
    if (m[1]) continue; // TEMP
    const nome = nomeCanonico(m[2]);
    if (!nome.startsWith("public.")) continue;
    if (!decididas.has(nome) && !faltam.includes(nome)) faltam.push(nome);
  }
  return faltam;
}

function mensagem(arquivo, tabela) {
  return `supabase/migrations/${arquivo}: cria a tabela ${tabela} sem dizer quem pode usá-la. Desde 30/05/2026 o Supabase não dá mais acesso automático a tabela nova em projeto novo (as lojas antigas ainda dão), então esta migration deixaria lojas diferentes com permissões diferentes. Acrescente no MESMO arquivo, depois do CREATE TABLE: "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${tabela} TO <só os papéis que precisam: anon, authenticated, service_role>;" ou, se nenhum deles deve usá-la, "REVOKE ALL ON TABLE ${tabela} FROM anon, authenticated, service_role;". Numa loja antiga o GRANT sozinho não tira nada do que a regra antiga já deu: para restringir, REVOKE ALL antes do GRANT.`;
}

/** [{arquivo, tabela, mensagem}] das migrations NOVAS da pasta (só a raiz da
 * fila: rollback-manual-* e subpastas ficam de fora). */
function conferirPasta(pasta = PASTA_PADRAO) {
  const achados = [];
  for (const arquivo of fs.readdirSync(pasta).sort()) {
    if (!ehMigrationNova(arquivo)) continue;
    const caminho = path.join(pasta, arquivo);
    if (!fs.statSync(caminho).isFile()) continue;
    for (const tabela of tabelasSemDecisao(fs.readFileSync(caminho, "utf8"))) {
      achados.push({ arquivo, tabela, mensagem: mensagem(arquivo, tabela) });
    }
  }
  return achados;
}

function main() {
  const pasta = process.argv[2] ? path.resolve(process.argv[2]) : PASTA_PADRAO;
  const achados = conferirPasta(pasta);
  if (achados.length === 0) {
    console.log(
      `[acesso das tabelas novas] OK: nenhuma migration depois de ${CORTE_DE_VERSAO} cria tabela em public sem GRANT ou REVOKE ALL.`,
    );
    return 0;
  }
  for (const a of achados)
    console.error(`[acesso das tabelas novas] ${a.mensagem}`);
  return 1;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  CORTE_DE_VERSAO,
  VERSOES_ANTIGAS_DE_13_DIGITOS,
  ehMigrationNova,
  semComentarios,
  tabelasSemDecisao,
  conferirPasta,
  mensagem,
};
