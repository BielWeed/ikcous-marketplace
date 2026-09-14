#!/usr/bin/env node
/* eslint-disable security/detect-object-injection --
 * Índices dinâmicos são chaves de listas FIXAS deste arquivo (nomes de
 * arquivo da própria fila, papéis de fábrica, estados conhecidos). Nunca há
 * payload de terceiro. */

/**
 * CI-BANCO, prova (b): o MESMO mecanismo do job "objetos" do ci.yml
 * (scripts/db-check-objetos-do-codigo.mjs — BANCO-080/#139), apontado para o
 * banco EFÊMERO em vez do banco de desenvolvimento: confere que todo objeto
 * que o código usa (.from/.rpc/bucket de storage) existe e é alcançável no
 * banco que acabou de nascer do zero.
 *
 * POR QUE ESTE WRAPPER EXISTE (e não o .mjs original direto): o lerCatalogo()
 * do original deixa `ssl: { rejectUnauthorized: false }` CRAVADO — necessário
 * no Supabase gerenciado, fatal em localhost (o service do CI não tem TLS:
 * "The server does not support SSL connections"). O original é de outra
 * frente, então aqui vai a PROPOSTA registrada na mesa: tornar o ssl
 * condicional lá. Enquanto isso, este wrapper importa as funções PURAS do
 * original (extrairDoRepo, avaliar, formatar, formatarDinamicas — a mecânica
 * é A MESMA, provada pelos testes dele) e reimplementa só a leitura de
 * catálogo, com o MESMO SQL, verbatim. Se o SQL divergir, o job "objetos" do
 * ci.yml e este passam a discordar em PR visível — divergência que não se
 * esconde.
 *
 * Veredito idêntico ao original: AUSENTE ou INALCANÇÁVEL = saída 1;
 * storage inacessível = aviso e saída segue (a checagem de bucket fica cega,
 * avisada); sem defeito = saída 0.
 *
 * USO: node scripts/ci/banco/objetos-do-codigo-efemero.cjs (a partir da raiz
 * do repositório; DATABASE_URL do efêmero + CI_BANCO_EFEMERO=1)
 */

"use strict";

const { Client } = require("pg");
const {
  extrairDoRepo,
  avaliar,
  formatar,
  formatarDinamicas,
} = require("../../../scripts/db-check-objetos-do-codigo.mjs");
const { ROTULO, sair, lerDatabaseUrlEfemero } = require("./util.cjs");

const PAPEIS = ["anon", "authenticated", "service_role"];

// SQL VERBATIM de scripts/db-check-objetos-do-codigo.mjs (lerCatalogo) —
// não altere aqui sem alterar lá (e vice-versa). A única diferença é o ssl
// condicional da conexão.
const SQL_RELACOES = `
    SELECT c.relname AS nome,
           (has_table_privilege('anon',     quote_ident(n.nspname)||'.'||quote_ident(c.relname), 'SELECT')
            OR has_any_column_privilege('anon',     quote_ident(n.nspname)||'.'||quote_ident(c.relname), 'SELECT')) AS anon,
           (has_table_privilege('authenticated', quote_ident(n.nspname)||'.'||quote_ident(c.relname), 'SELECT')
            OR has_any_column_privilege('authenticated', quote_ident(n.nspname)||'.'||quote_ident(c.relname), 'SELECT')) AS authenticated,
           (has_table_privilege('service_role', quote_ident(n.nspname)||'.'||quote_ident(c.relname), 'SELECT')
            OR has_any_column_privilege('service_role', quote_ident(n.nspname)||'.'||quote_ident(c.relname), 'SELECT')) AS service_role
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','f')
  `;
const SQL_FUNCOES = `
    SELECT p.proname AS nome,
           has_function_privilege('anon', p.oid::regprocedure::text, 'EXECUTE') AS anon,
           has_function_privilege('authenticated', p.oid::regprocedure::text, 'EXECUTE') AS authenticated,
           has_function_privilege('service_role', p.oid::regprocedure::text, 'EXECUTE') AS service_role
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  `;

async function lerCatalogoEfemero(connectionString) {
  // Efêmero localhost não tem TLS; URL com sslmode=true/require aceita TLS
  // (nenhum alvo desta frente é gerenciado — util.cjs recusa).
  const querTls = /sslmode=(require|verify-ca|verify-full|no-verify)/.test(
    connectionString,
  );
  const cliente = new Client({
    connectionString,
    ...(querTls ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await cliente.connect();

  const rel = await cliente.query(SQL_RELACOES);
  const relacoes = new Map();
  for (const r of rel.rows) {
    const papeis = new Set(PAPEIS.filter((p) => r[p]));
    relacoes.set(r.nome, papeis);
  }

  const fn = await cliente.query(SQL_FUNCOES);
  const funcoes = new Map();
  for (const r of fn.rows) {
    if (!funcoes.has(r.nome)) funcoes.set(r.nome, new Set());
    for (const p of PAPEIS) {
      if (r[p]) funcoes.get(r.nome).add(p);
    }
  }

  // Mesma tolerância do original: sem o schema storage, a checagem de bucket
  // fica cega e o aviso manda (silêncio aqui escondia a cegueira).
  const buckets = new Set();
  try {
    const bk = await cliente.query("SELECT id FROM storage.buckets");
    for (const r of bk.rows) buckets.add(r.id);
  } catch {
    return { relacoes, funcoes, buckets, bucketsAcessivel: false };
  }

  await cliente.end();
  return { relacoes, funcoes, buckets, bucketsAcessivel: true };
}

async function main() {
  const url = lerDatabaseUrlEfemero();
  const { referencias, dinamicas } = extrairDoRepo();
  const catalogo = await lerCatalogoEfemero(url);
  if (!catalogo.bucketsAcessivel) {
    console.warn(
      "::warning::Sem acesso a storage.buckets no efêmero — a checagem de BUCKET está cega nesta rodada (tabelas e funções seguem conferidas).",
    );
  }
  const resultado = avaliar(referencias, catalogo);

  const unicos = new Set(referencias.map((r) => `${r.tipo}:${r.nome}`));
  console.log(
    `[${ROTULO}/(b)] Referências literais no código: ${referencias.length} (${unicos.size} objetos únicos) — ${catalogo.relacoes.size} relações e ${catalogo.funcoes.size} funções no catálogo public do EFÊMERO.`,
  );
  const blocoDinamicas = formatarDinamicas(dinamicas);
  if (blocoDinamicas) console.log(blocoDinamicas);

  if (resultado.ausentes.length === 0 && resultado.inalcançaveis.length === 0) {
    console.log(
      `[${ROTULO}/(b)] TODAS as referências do código existem e são alcançáveis no banco que nasceu do zero.`,
    );
    process.exit(0);
  }
  console.log(formatar(resultado));
  sair(
    "FALHOU",
    "O banco que nasceu do zero NÃO cobre o que o código usa. Ou falta migration, ou falta GRANT — exatamente a classe da #139 (vw_produtos_admin) e da #114 (EXECUTE de RPC).",
  );
}

main().catch((erro) =>
  sair("INDETERMINADO", erro?.stack ? erro.stack : String(erro)),
);
