"use strict";

/**
 * Esqueleto compartilhado das provas VIVAS das migrations do lote 234 (20261396000000, 20261396100000 e 20261396200000): migrations
 * que so CRIAM objeto novo (gatilho + funcao, ou um CHECK NOT VALID) e nao redefinem nada que ja existia. Nao e' uma prova por si:
 * cada `*-viva.cjs` traz a semente, o comportamento e os mutantes dele e usa isto para o que e' igual em todas:
 *
 *  - uma transacao por caso, SEMPRE desfeita (o banco e' o clone descartavel do rodar-isolado.cjs), com o fuso fixo em UTC;
 *  - `como(papel, ...)`: roda como anon/authenticated/service_role (ou sessao direta) com o auth.uid() e o JWT pedidos;
 *    `tentar(...)`/`aplicar(...)`: o erro nao derruba a transacao (savepoint) e volta {erro, codigo};
 *  - `retrato()`: tudo o que a migration NAO pode tocar (funcoes com corpo e ACL, ACL das tabelas, politicas, gatilhos e restricoes),
 *    medido com os objetos novos EXCLUIDOS, para provar "so objeto novo";
 *  - `travaAberta()`: uma gravacao em voo segura o ALTER/CREATE TRIGGER e a migration FALHA LIMPA no lock_timeout, sem deixar nada;
 *  - o roteiro de saida (PASSOU por prova, falha com o nome da prova).
 *
 * Somente Postgres EFEMERO (rodar-isolado.cjs; efemero.cjs recusa qualquer outro alvo). Nunca banco de loja.
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp --
 * Os caminhos vem do proprio repositorio (as migrations e as consultas), nunca de entrada de rede; o padrao de RegExp de
 * `blocoDe` e' montado do nome de um bloco DO que o proprio teste escreve (nunca de entrada de rede). */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(RAIZ, "supabase", "migrations");
const CONSULTAS = path.join(RAIZ, "scripts", "publicacao", "consultas");
const norm = (s) => s.replace(/\r\n/g, "\n");
const emCRLF = (s) => norm(s).replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const lerMigration = (nome) =>
  norm(fs.readFileSync(path.join(MIGRATIONS, nome), "utf8"));
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio repositorio
const CONFERIR = require(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
);
const ROL = new Map(Object.entries(CONFERIR.ROL_FECHADO_POR_CONSULTA));

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });
const conexao = () => C;

async function conectar() {
  C = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await C.connect();
  return C;
}

/** Uma transacao por caso, sempre desfeita. `montar` prepara o estado (ANTES/DEPOIS) logo depois do fuso. */
async function emTransacao(fn, montar) {
  await C.query("BEGIN");
  try {
    await C.query("SET LOCAL TIME ZONE 'UTC'");
    if (montar) await montar();
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel` (null = sessao direta, `role` = none), com o JWT e o auth.uid() pedidos. */
async function como(
  papel,
  sql,
  params = [],
  { uid = "", claims = "" } = {},
  c = C,
) {
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [uid, claims],
  );
  if (papel) await c.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    // transacao abortada nao aceita RESET ROLE e o erro dela esconderia o original
    await c.query("RESET ROLE").catch(() => {});
  }
}

/** Como `como`, mas o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo, detalhe}. */
async function tentar(papel, sql, params = [], id = {}) {
  await C.query("SAVEPOINT tentativa");
  try {
    const linhas = await como(papel, sql, params, id);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return {
      erro: e.message,
      codigo: e.code,
      detalhe: e.detail,
      restricao: e.constraint,
    };
  }
}

/** Aplica um arquivo dentro de um savepoint: devolve null se aplicou ou {erro, codigo}. */
async function aplicar(sql) {
  await C.query("SAVEPOINT arquivo");
  try {
    await C.query(sql);
    await C.query("RELEASE SAVEPOINT arquivo");
    return null;
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT arquivo");
    await C.query("RELEASE SAVEPOINT arquivo");
    return { erro: e.message, codigo: e.code };
  }
}

/** Espera que `sql` seja recusado (padrao na mensagem) e desfaz o que fez. */
async function recusa(sql, padrao) {
  const r = await aplicar(sql);
  assert.ok(r, `devia ter recusado: ${String(sql).slice(0, 80)}`);
  assert.match(r.erro, padrao);
  return r;
}

/**
 * Tudo o que uma migration "so objeto novo" NAO pode tocar, em public: funcoes (assinatura, OID, ACL, corpo, atributos), ACL das
 * tabelas, politicas, gatilhos e restricoes. `sem` lista os objetos NOVOS, que ficam de fora: {funcoes, gatilhos, restricoes}.
 */
async function retrato({ funcoes = [], gatilhos = [], restricoes = [] } = {}) {
  const q = async (sql, params) => (await C.query(sql, params)).rows;
  return {
    funcoes: await q(
      `SELECT p.oid::regprocedure::text AS f, p.oid::text AS oid, p.proacl::text AS acl, md5(p.prosrc) AS corpo,
              p.prosecdef, p.provolatile, p.proconfig::text AS cfg
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND NOT (p.proname = ANY ($1::text[])) ORDER BY 1`,
      [funcoes],
    ),
    tabelas: await q(
      `SELECT c.oid::regclass::text AS t, c.relacl::text AS acl, c.relrowsecurity AS rls
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v','m','p') ORDER BY 1`,
    ),
    politicas: await q(
      `SELECT polrelid::regclass::text AS t, polname, polcmd, polroles::text AS roles, pg_get_expr(polqual, polrelid) AS q,
              pg_get_expr(polwithcheck, polrelid) AS wc
         FROM pg_policy WHERE polrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace) ORDER BY 1, 2`,
    ),
    gatilhos: await q(
      `SELECT tgrelid::regclass::text AS t, tgname, tgtype, tgenabled, tgfoid::regproc::text AS f FROM pg_trigger
        WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)
          AND NOT (tgname = ANY ($1::text[])) ORDER BY 1, 2`,
      [gatilhos],
    ),
    restricoes: await q(
      `SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace AND NOT (conname = ANY ($1::text[])) ORDER BY 1, 2`,
      [restricoes],
    ),
  };
}

/**
 * Uma gravacao em voo (outra conexao, transacao aberta) segura o lock da tabela; a migration, numa transacao, tem de FALHAR
 * LIMPA no lock_timeout (55P03) e nao deixar nada; depois que a gravacao termina, a mesma migration aplica. `gravar(c2)` abre a
 * gravacao em voo (BEGIN ja feito); `aplicado()` diz se o objeto novo existe (tem de ser falso apos a falha).
 */
async function travaAberta({ sqlMigracao, gravar, aplicado }) {
  const url = lerDatabaseUrlEfemera();
  const c2 = new Client({ connectionString: url });
  const c1 = new Client({ connectionString: url });
  await c2.connect();
  await c1.connect();
  try {
    await c2.query("BEGIN");
    await c2.query("SET LOCAL session_replication_role = replica");
    await gravar(c2);
    await c1.query("BEGIN");
    const t0 = Date.now();
    let erro;
    try {
      await c1.query(sqlMigracao);
    } catch (e) {
      erro = e;
    }
    const espera = Date.now() - t0;
    await c1.query("ROLLBACK");
    assert.ok(
      erro,
      "a migration devia falhar no lock_timeout, nao travar nem passar",
    );
    assert.equal(
      erro.code,
      "55P03",
      `esperava lock_not_available, veio ${erro.code}: ${erro.message}`,
    );
    assert.ok(
      espera >= 4000 && espera < 15000,
      `esperou ${espera} ms (esperado ~5 s)`,
    );
    assert.equal(
      await aplicado(c1),
      false,
      "a falha deixou o objeto novo para tras",
    );
    await c2.query("ROLLBACK");
    await c1.query("BEGIN");
    await c1.query(sqlMigracao);
    assert.equal(
      await aplicado(c1),
      true,
      "depois da gravacao terminar, a migration nao aplicou",
    );
    await c1.query("ROLLBACK");
  } finally {
    await c2.query("ROLLBACK").catch(() => {});
    await c1.query("ROLLBACK").catch(() => {});
    await c2.end().catch(() => {});
    await c1.end().catch(() => {});
  }
}

/** Roda uma consulta de conferencia e confere o rol fechado do conferir-banco. Devolve os itens que NAO estao ok (ordenados). */
async function consulta(nome) {
  const rows = (await C.query(lerConsulta(nome))).rows;
  assert.deepEqual(
    rows.map((r) => r.item).sort(),
    [...ROL.get(nome)].sort(),
    `${nome}: o rol nao e o do conferir-banco`,
  );
  return rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item)
    .sort();
}

/** Extrai o bloco DO $conferencia...$ de uma migration para rodar sozinho (o pos-voo recusa cada estrago). */
function blocoDe(sql, marca) {
  const m = new RegExp(`DO \\$${marca}\\$[\\s\\S]*?END \\$${marca}\\$;`).exec(
    sql,
  );
  assert.ok(m, `bloco ${marca} nao achado`);
  return m[0];
}

async function executar(titulo) {
  let falhas = 0;
  for (const { nome, corpo } of PROVAS) {
    try {
      await corpo();
      console.log(`  PASSOU ${nome}`);
    } catch (e) {
      falhas += 1;
      console.error(`  FALHOU ${nome}\n${e.stack || e}`);
    }
  }
  if (falhas > 0)
    falhar(
      "FALHOU",
      `${titulo}: ${falhas} de ${PROVAS.length} provas falharam`,
    );
  console.log(`\n[${titulo}] todas as ${PROVAS.length} provas passaram.`);
}

module.exports = {
  RAIZ,
  assert,
  md5,
  sha256,
  norm,
  emCRLF,
  lerMigration,
  lerConsulta,
  ROL,
  conectar,
  conexao,
  prova,
  emTransacao,
  como,
  tentar,
  aplicar,
  recusa,
  retrato,
  travaAberta,
  consulta,
  blocoDe,
  executar,
  falhar,
};
