"use strict";

/**
 * Prova VIVA de que a consulta 8e-conferir-92-a-202-aplicado.sql (rol fechado da
 * faixa 92-202, pré-checagem do backfill do ledger 92-202 e prova de objetos do
 * lote 92-202 no portão da release) aceita OS DOIS ESTADOS das funções que
 * migrations DEPOIS da 202 redefinem — num Postgres EFÊMERO local, nada de rede,
 * nada de loja:
 *   painel_inicio()                       20261199 → 20261212000000 → 20261228000000;
 *   get_admin_analytics_v2(integer)       20261199 → 20261214000000 → 20261234000000;
 *   crm_visao(date,date)                  20261199 → 20261227000000 → 20261232000000 (a grade do CRM:
 *                                         a CADEIA do painel_inicio, 99 → 12 → 28, repetida);
 *   get_admin_customers_paged(...)        20261199 → 20261230000000 (a busca de clientes);
 *   crm_clientes(text,text,integer,integer) 20261199 → 20261231000000 (a busca do CRM);
 *   registrar_venda_presencial(...)       20261199 → 20261235000000 (a venda repetida do balcão);
 *   upsert_store_config(jsonb)            20261199 → 20261239000000 (a identidade legal da loja).
 * Sem isso a 8e dava ok=false nessas linhas numa loja que recebeu a sucessora e
 * o backfill do ledger 92-202 ficava bloqueado para sempre (CI run 38000693188,
 * passo "Prova viva do lote 60-66"). Cada função é POR SI: uma loja pode ter só
 * uma das sucessoras.
 *
 * COMO RODA: o banco é o clone que o rodar-isolado.cjs entrega (a árvore inteira
 * migrada: 12, 13 e 14 aplicadas). Cada estado é montado DENTRO de uma transação
 * (como o dono da conexão) que termina em ROLLBACK; a consulta roda nela como um
 * papel de LEITURA não superusuário (BYPASSRLS + pg_read_all_data, imita o
 * supabase_read_only_user) com a transação já somente leitura. O estado da 99 é o
 * das sucessoras desfeitas pelo rollback-manual de cada uma
 * (tests/banco/sucessoras-da-99.cjs `desfazerSucessorasDa99`); o MISTO é UM
 * rollback-manual só. Cada veredito é levado ao PORTÃO de verdade
 * (`evidenciaDaProva`, de scripts/frota/publicar-release.mjs) e à pré-checagem do
 * ledger (`conferirRolFechado`, de scripts/publicacao/conferir-banco.cjs):
 * "positiva" = POSITIVA para o portão, com rol=ok, e a pré-checagem aceita;
 * "reprova" = NEGATIVA para o portão e a pré-checagem LANÇA (o backfill não grava).
 *
 * CASOS:
 *  POSITIVOS  árvore inteira (todas as sucessoras no ar); estado da 99 (todas
 *             desfeitas); painel parado na 12, analytics na 14 e crm na 27; e UM estado "só esta" para cada
 *             função que não é o painel (só a 14, só a 27, só a 30, só a 31, só a 35, só a 39:
 *             as outras desfeitas). Em todos: todas as linhas ok=true, EXATAMENTE o
 *             ROL_DA_8E (mesmo nº de linhas), e as respostas dos estados são IGUAIS
 *             linha a linha (o `vivo` aceito mostra o `esperado`, que é o hash da 99).
 *  NEGATIVOS  para CADA função com sucessora, reprovando SÓ a linha dela: corpo estranho
 *             (CREATE OR REPLACE inócuo: um comentário a mais; vivo = o md5 dele),
 *             função AUSENTE (vivo = 'AUSENTE'), sobrecarga extra com o MESMO corpo
 *             (vivo = os dois md5 com vírgula) e o corpo da sucessora da OUTRA
 *             função (o aceito é por função; esse caso só roda na árvore inteira).
 *             No estado da 99 rodam o estranho e o AUSENTE; nos mistos, o estranho, o
 *             AUSENTE e a sobrecarga.
 *             Controle: uma das outras 54 (save_store_identity) com corpo estranho
 *             reprova só ela (nada mais foi afrouxado).
 *  MUTANTES   o texto da consulta com o hash da sucessora trocado, os aceitos
 *             removidos (sem o OR e com o CTE vazio), o aceito de qualquer função
 *             (sem `s.fn = f.fn`), o hash da 99 trocado, AUSENTE aceito, corpo
 *             estranho aceito e sobrecarga aceita (sem o string_agg): cada um deixa
 *             um positivo reprovar ou um negativo passar, e esta prova ficaria
 *             VERMELHA.
 *
 * Toda montagem tem GUARDA (o hash vivo de cada função é conferido antes da
 * consulta): sem ela, um estado que não montou vira falso verde. O papel
 * temporário tem nome único e sai no fim.
 *
 * LIMITES DECLARADOS: o Postgres é o 17 LOCAL; o papel de leitura real das lojas
 * e a Management API não são tocados. Esta prova diz que a 8e DECIDE certo, não
 * em que estado a CAF ou a Savy estão (isso só o run da consulta contra o ref).
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/portao-8e-aceita-sucessoras-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vêm do próprio repositório (a pasta de consultas, as migrations e o
 * publicar-release.mjs), nunca de entrada de rede; as chaves de objeto vêm do
 * módulo das sucessoras e de constantes deste arquivo, nunca de entrada externa. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");
const {
  SUCESSORAS_DA_99,
  conferirLista,
  desfazerSucessorasDa99,
} = require("./sucessoras-da-99.cjs");

const REPO = path.resolve(__dirname, "..", "..");
process.chdir(REPO);
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
const CONSULTA = "8e-conferir-92-a-202-aplicado";
const SQL_8E = fs.readFileSync(
  path.join(REPO, "scripts", "publicacao", "consultas", `${CONSULTA}.sql`),
  "utf8",
);
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do próprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);
const N = CONF.ROL_DA_8E.length;

// As sucessoras, pelo nome da função. Os hashes (vigente = o da 99, desta = o da
// sucessora) vêm do PREFLIGHT de cada migration, lidos pelo módulo; nenhum
// literal solto aqui.
const fnDe = (s) =>
  s.assinatura.slice("public.".length, s.assinatura.indexOf("("));
// A CADEIA de cada função, em ordem de aplicação: painel_inicio = [12, 28] (o `hashVigente` da 28 é
// o `hashDesta` da 12), get_admin_analytics_v2 = [14, 34] (idem: o `hashVigente` da 34 é o `hashDesta`
// da 14), crm_visao = [27, 32] (idem: o `hashVigente` da 32 é o `hashDesta` da 27),
// get_admin_customers_paged = [30], crm_clientes = [31], registrar_venda_presencial = [35],
// upsert_store_config = [39].
// O representante de cada função é o ÚLTIMO elo (o topo da cadeia); o corpo da 99 é o `hashVigente` do PRIMEIRO.
const CADEIAS = new Map();
for (const s of SUCESSORAS_DA_99)
  CADEIAS.set(fnDe(s), [...(CADEIAS.get(fnDe(s)) ?? []), s]);
const topo = (fn) => CADEIAS.get(fn).at(-1);
const PAINEL = topo("painel_inicio");
const PAINEL_12 = CADEIAS.get("painel_inicio")[0];
const ANALYTICS = topo("get_admin_analytics_v2");
const ANALYTICS_14 = CADEIAS.get("get_admin_analytics_v2")[0];
const CRM = topo("crm_visao");
const CRM_27 = CADEIAS.get("crm_visao")[0];
const CLIENTES = topo("get_admin_customers_paged");
const CRMC = topo("crm_clientes");
const VENDA = topo("registrar_venda_presencial");
const UPSERT = topo("upsert_store_config");
assert.ok(
  SUCESSORAS_DA_99.length === 10 &&
    CADEIAS.size === 7 &&
    CADEIAS.get("painel_inicio").length === 2 &&
    PAINEL_12.hashDesta === PAINEL.hashVigente &&
    CADEIAS.get("get_admin_analytics_v2").length === 2 &&
    ANALYTICS_14.hashDesta === ANALYTICS.hashVigente &&
    CADEIAS.get("crm_visao").length === 2 &&
    CRM_27.hashDesta === CRM.hashVigente &&
    CADEIAS.get("get_admin_customers_paged").length === 1 &&
    CADEIAS.get("crm_clientes").length === 1 &&
    CADEIAS.get("registrar_venda_presencial").length === 1 &&
    CADEIAS.get("upsert_store_config").length === 1,
  "as sucessoras da 99 deixaram de ser a 20261212 + 20261228 (painel_inicio), a 20261214 + 20261234 (get_admin_analytics_v2), a 20261227 + 20261232 (crm_visao), a 20261230 (get_admin_customers_paged), a 20261231 (crm_clientes), a 20261235 (registrar_venda_presencial) e a 20261239 (upsert_store_config): reveja a 8e e esta prova",
);
const FUNCOES = [PAINEL, ANALYTICS, CRM, CLIENTES, CRMC, VENDA, UPSERT];
/** O corpo da 99 da função (o `esperado` da 8e), o `hashVigente` do primeiro elo da cadeia. */
const h99 = (s) => CADEIAS.get(fnDe(s))[0].hashVigente;
/** Todo corpo que a 8e aceita para a função: o da 99 e o de cada elo da cadeia. */
const aceitosDe = (s) => [
  h99(s),
  ...CADEIAS.get(fnDe(s)).map((x) => x.hashDesta),
];
const item = (s) => `corpo final ${fnDe(s)}`;
const OUTRA = new Map([
  [PAINEL, ANALYTICS],
  [ANALYTICS, CRM],
  [CRM, CLIENTES],
  [CLIENTES, CRMC],
  [CRMC, VENDA],
  [VENDA, UPSERT],
  [UPSERT, PAINEL],
]);

const REF = "gnjsrucsmjkajijrakzr";
const SHA40 = "e".repeat(40);
const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const RO = `p8e_ro_${SUF}`;

let resultados = 0;
function ok(msg) {
  resultados += 1;
  console.log(`  ok ${resultados}. ${msg}`);
}
const lerMigracao = (nome) =>
  fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const reprovadas = (rows) =>
  rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item)
    .sort();
function linha(rows, nome) {
  const l = rows.filter((r) => r.item === nome);
  assert.equal(l.length, 1, `esperava 1 linha de "${nome}", achei ${l.length}`);
  return l[0];
}

// ---------------------------------------------------------------------------
// Estado: montado numa transação desfeita; a consulta como papel só-leitura
// ---------------------------------------------------------------------------
async function hashVivo(c, assinatura) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0] ? r.rows[0].h : null;
}
/** GUARDA do estado: o corpo vivo de cada função é o pedido. */
async function exigirHashes(c, rotulo, esperados) {
  for (const s of FUNCOES)
    assert.equal(
      await hashVivo(c, s.assinatura),
      esperados.get(s),
      `${rotulo}: ${fnDe(s)}`,
    );
}
/** O estado em que SO as funcoes de `mantidas` estao no topo da cadeia; as outras, no corpo da 99. */
const hashesCom = (mantidas, painelNo = PAINEL) =>
  new Map(
    FUNCOES.map((s) => [
      s,
      !mantidas.includes(s)
        ? h99(s)
        : s === PAINEL
          ? painelNo.hashDesta
          : s.hashDesta,
    ]),
  );

/**
 * BEGIN; `montar` (como o dono da conexão); SET LOCAL ROLE só-leitura e a
 * transação somente leitura; cada texto de consulta; ROLLBACK. Devolve as linhas
 * de cada texto e o que `montar` devolveu.
 */
let C; // a conexão única com o clone do rodar-isolado
async function noEstado(montar, textos = [SQL_8E]) {
  await C.query("BEGIN");
  try {
    const montado = montar ? await montar(C) : undefined;
    await C.query(`SET LOCAL ROLE ${RO}`);
    await C.query("SET LOCAL transaction_read_only = on");
    assert.equal(
      (await C.query("SHOW transaction_read_only")).rows[0]
        .transaction_read_only,
      "on",
    );
    const saidas = [];
    for (const texto of textos) {
      assert.equal(CONF.contarStatements(texto), 1, "exatamente 1 statement");
      const r = await C.query(texto);
      assert.deepEqual(
        r.fields.map((f) => f.name),
        ["item", "esperado", "vivo", "ok"],
        "colunas item/esperado/vivo/ok",
      );
      saidas.push(r.rows);
    }
    return { rows: saidas[0], saidas, montado };
  } finally {
    await C.query("ROLLBACK");
  }
}

// --- as montagens -----------------------------------------------------------
const ARVORE = async (c) => exigirHashes(c, "árvore", hashesCom(FUNCOES));
const ESTADO_99 = async (c) => {
  await ARVORE(c);
  const desfeitas = await desfazerSucessorasDa99(c);
  assert.deepEqual(
    desfeitas,
    SUCESSORAS_DA_99.map((s) => s.nome).reverse(),
    "as dez sucessoras tinham de estar no ar e sair",
  );
  await exigirHashes(c, "estado 99", hashesCom([]));
};
/** Desfaz UMA sucessora pelo rollback-manual dela (o preflight dele exige o desta). */
const desfazerUma = (s) => async (c) => {
  assert.equal(await hashVivo(c, s.assinatura), s.hashDesta, s.nome);
  await c.query(lerMigracao(s.rollback));
  assert.equal(
    await hashVivo(c, s.assinatura),
    s.hashVigente,
    `${s.rollback} não devolveu o corpo anterior na cadeia`,
  );
};
/** O painel PARADO NA 12 (a 28 desfeita): o intermediário da cadeia segue aceito. */
const PAINEL_NA_12 = async (c) => {
  await ARVORE(c);
  await desfazerUma(PAINEL)(c);
  await exigirHashes(
    c,
    "painel na 12",
    hashesCom(
      FUNCOES.filter((s) => s !== PAINEL),
      PAINEL_12,
    ).set(PAINEL, PAINEL_12.hashDesta),
  );
};
/** O analytics PARADO NA 14 (a 34 desfeita): o intermediário da cadeia segue aceito. */
const ANALYTICS_NA_14 = async (c) => {
  await ARVORE(c);
  await desfazerUma(ANALYTICS)(c);
  await exigirHashes(
    c,
    "analytics na 14",
    hashesCom(FUNCOES.filter((s) => s !== ANALYTICS)).set(
      ANALYTICS,
      ANALYTICS_14.hashDesta,
    ),
  );
};
/** O CRM PARADO NA 27 (a 32 desfeita): o intermediário da cadeia segue aceito. */
const CRM_NA_27 = async (c) => {
  await ARVORE(c);
  await desfazerUma(CRM)(c);
  await exigirHashes(
    c,
    "crm na 27",
    hashesCom(FUNCOES.filter((s) => s !== CRM)).set(CRM, CRM_27.hashDesta),
  );
};
/** SÓ `mantida` no ar (no topo da sua cadeia): todas as outras voltam à 99, desfeitas pelo
 * rollback-manual de cada elo, do topo para a base da cadeia. */
const SO = (mantida, rotulo) => async (c) => {
  await ARVORE(c);
  for (const [fn, cadeia] of CADEIAS)
    if (fn !== fnDe(mantida))
      for (const elo of [...cadeia].reverse()) await desfazerUma(elo)(c);
  await exigirHashes(c, rotulo, hashesCom([mantida]));
};
const SO_14 = SO(ANALYTICS, "só 14");
const SO_27 = SO(CRM, "só 27 + 32");
const SO_30 = SO(CLIENTES, "só 30");
const SO_31 = SO(CRMC, "só 31");
const SO_35 = SO(VENDA, "só 35");
const SO_39 = SO(UPSERT, "só 39");
const ESTADOS = [
  ["árvore inteira (12, 28, 14, 34, 27, 32, 30, 31, 35 e 39 no ar)", ARVORE],
  ["estado da 20261199 (as dez sucessoras desfeitas)", ESTADO_99],
  ["painel parado na 20261212 (a 20261228 desfeita)", PAINEL_NA_12],
  ["analytics parado na 20261214 (a 20261234 desfeita)", ANALYTICS_NA_14],
  ["crm parado na 20261227 (a 20261232 desfeita)", CRM_NA_27],
  ["misto: só a 20261214 + 20261234 (as outras desfeitas)", SO_14],
  ["misto: só a 20261227 + 20261232 (as outras desfeitas)", SO_27],
  ["misto: só a 20261230 (as outras desfeitas)", SO_30],
  ["misto: só a 20261231 (as outras desfeitas)", SO_31],
  ["misto: só a 20261235 (as outras desfeitas)", SO_35],
  ["misto: só a 20261239 (as outras desfeitas)", SO_39],
];

/** CREATE OR REPLACE com o texto de pg_get_functiondef e o corpo transformado
 * (cabeçalho, atributos e ACL intactos). */
async function reescreverCorpo(c, assinatura, transformar) {
  const def = (
    await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
      assinatura,
    ])
  ).rows[0].d;
  assert.ok(def, `${assinatura}: sem definição`);
  const i = def.indexOf("$function$");
  const j = def.lastIndexOf("$function$");
  assert.ok(i > 0 && j > i, "pg_get_functiondef sem $function$");
  const corpo = def.slice(i + "$function$".length, j);
  const novo = transformar(corpo);
  assert.notEqual(novo, corpo, `${assinatura}: a transformação não mudou nada`);
  await c.query(def.slice(0, i + "$function$".length) + novo + def.slice(j));
}
/** Corpo ESTRANHO: um comentário a mais (inócuo). GUARDA: o md5 vivo não é aceito. */
const corpoEstranho = (assinatura, aceitos) => async (c) => {
  await reescreverCorpo(
    c,
    assinatura,
    (corpo) => `\n-- corpo estranho (prova da 8e)\n${corpo}`,
  );
  const h = await hashVivo(c, assinatura);
  assert.match(String(h), /^[0-9a-f]{32}$/);
  assert.ok(!aceitos.includes(h), `${assinatura}: o estranho caiu num aceito`);
  return h;
};
/** AUSENTE: DROP. GUARDA: nenhuma função com o nome em public. */
const ausente = (s) => async (c) => {
  await c.query(`DROP FUNCTION ${s.assinatura}`);
  const r = await c.query(
    `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public' AND p.proname = $1`,
    [fnDe(s)],
  );
  assert.equal(r.rows[0].n, 0, `${fnDe(s)}: o DROP não tirou a função`);
};
/** SOBRECARGA extra com o MESMO corpo (cada md5 sozinho seria aceito). GUARDA: 2
 * sobrecargas, corpos iguais. */
const sobrecarga = (s) => async (c) => {
  const def = (
    await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
      s.assinatura,
    ])
  ).rows[0].d;
  const cab = `FUNCTION public.${fnDe(s)}(`;
  const i = def.indexOf(cab);
  assert.ok(i > 0, `${fnDe(s)}: cabeçalho não achado`);
  const k = i + cab.length;
  const isca = def[k] === ")" ? "p_isca_8e text" : "p_isca_8e text, ";
  await c.query(def.slice(0, k) + isca + def.slice(k));
  const r = await c.query(
    `SELECT count(*)::int AS n, count(DISTINCT md5(replace(p.prosrc, E'\\r', '')))::int AS d
       FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public' AND p.proname = $1`,
    [fnDe(s)],
  );
  assert.deepEqual(r.rows[0], { n: 2, d: 1 }, `${fnDe(s)}: a isca não entrou`);
};
/** O corpo da sucessora da OUTRA função no lugar do desta (o aceito é POR função).
 * Sem validar o corpo (check_function_bodies = off, só nesta transação). GUARDA: o
 * md5 vivo é o aceito da outra. */
const corpoDaOutra = (s) => async (c) => {
  const doadora = OUTRA.get(s);
  assert.equal(await hashVivo(c, doadora.assinatura), doadora.hashDesta);
  const corpo = (
    await c.query(
      "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
      [doadora.assinatura],
    )
  ).rows[0].prosrc;
  await c.query("SET LOCAL check_function_bodies = off");
  await reescreverCorpo(c, s.assinatura, () => corpo);
  assert.equal(await hashVivo(c, s.assinatura), doadora.hashDesta);
};
const em =
  (...passos) =>
  async (c) => {
    let ultimo;
    for (const p of passos) ultimo = await p(c);
    return ultimo;
  };

// ---------------------------------------------------------------------------
// O PORTÃO e a pré-checagem do ledger
// ---------------------------------------------------------------------------
let PORTAO; // módulo ESM do portão (carregado em main)
let relogio = Date.parse("2026-10-09T12:00:00Z");
async function estadoNoPortao(rows) {
  relogio += 1000;
  const linhaDeVeredito = veredito(rows);
  return (
    await PORTAO.evidenciaDaProva({
      consulta: CONSULTA,
      projeto: "savy",
      ref: REF,
      sha: SHA40,
      topo: SHA40,
      validadeHoras: 6,
      agora: relogio + 60000,
      deps: {
        listarRuns: async (wf) =>
          wf === "conferir-banco-da-loja.yml"
            ? [
                {
                  databaseId: 1,
                  displayTitle: `conferir ${CONSULTA} em savy`,
                  headSha: SHA40,
                  createdAt: new Date(relogio).toISOString(),
                  conclusion: "success",
                  status: "completed",
                },
              ]
            : [],
        logDoRun: async () => `saida do job\n${linhaDeVeredito ?? ""}\n`,
        arvoreIgual: async () => true,
      },
    })
  ).estado;
}
const veredito = (rows) =>
  CONF.veredictoDaConsulta({
    consulta: CONSULTA,
    ref: REF,
    sha: SHA40,
    linhas: rows,
  });
const preChecagem = (rows) =>
  CONF.conferirRolFechado({
    faixa: "92-202",
    nomeConsulta: "8e",
    linhas: rows,
    rol: CONF.ROL_DA_8E,
  });

/** Formato de TODA resposta: o rol fechado EXATO (mesmo nº de linhas), `ok`
 * booleano, `ok=false` primeiro. */
function exigirFormato(rotulo, rows) {
  assert.equal(rows.length, N, `${rotulo}: nº de linhas`);
  assert.equal(
    CONF.estruturaDoRolFechado(rows, CONF.ROL_DA_8E),
    null,
    `${rotulo}: o rol fechado do código tem de ser EXATAMENTE o que a consulta devolveu`,
  );
  for (const r of rows) {
    assert.equal(typeof r.ok, "boolean", `${rotulo}: ok não booleano`);
    assert.deepEqual(
      [typeof r.item, typeof r.esperado, typeof r.vivo],
      ["string", "string", "string"],
      `${rotulo}: item/esperado/vivo têm de ser texto`,
    );
  }
  const oks = rows.map((r) => r.ok);
  assert.deepEqual(
    oks,
    [...oks].sort((a, b) => Number(a) - Number(b)),
    `${rotulo}: ok=false primeiro`,
  );
}
/** POSITIVA: nada reprova, as duas linhas mostram o hash da 99 no `vivo`, o
 * veredito sai com rol=ok, o portão dá POSITIVA e a pré-checagem aceita. */
async function exigirPositiva(rotulo, rows) {
  exigirFormato(rotulo, rows);
  assert.deepEqual(reprovadas(rows), [], `${rotulo}: nada podia reprovar`);
  for (const s of FUNCOES) {
    const l = linha(rows, item(s));
    assert.equal(l.esperado, h99(s), `${rotulo}: esperado de ${item(s)}`);
    assert.equal(l.vivo, l.esperado, `${rotulo}: vivo de ${item(s)}`);
  }
  assert.ok(
    veredito(rows).endsWith(`linhas=${N} ok_false=0 ok_nao_booleano=0 rol=ok`),
    `${rotulo}: veredito ${veredito(rows)}`,
  );
  assert.equal(await estadoNoPortao(rows), "POSITIVA", rotulo);
  preChecagem(rows);
}
/** NEGATIVA: reprova EXATAMENTE `esperadas`, o portão NUNCA dá POSITIVA e a
 * pré-checagem do ledger LANÇA (o backfill não grava). */
async function exigirReprovadas(rotulo, rows, esperadas) {
  exigirFormato(rotulo, rows);
  assert.deepEqual(
    reprovadas(rows),
    [...esperadas].sort(),
    `${rotulo}: reprovou ${JSON.stringify(reprovadas(rows))}, esperava ${JSON.stringify(esperadas)}`,
  );
  assert.ok(
    veredito(rows).endsWith(
      `linhas=${N} ok_false=${esperadas.length} ok_nao_booleano=0 rol=ok`,
    ),
    `${rotulo}: veredito ${veredito(rows)}`,
  );
  assert.equal(await estadoNoPortao(rows), "NEGATIVA", rotulo);
  assert.throws(
    () => preChecagem(rows),
    /pré-checagem do ledger 92-202 falhou: 8e tem "corpo final /,
    `${rotulo}: a pré-checagem do ledger aceitou um negativo`,
  );
}

// ---------------------------------------------------------------------------
// Mutantes do texto da consulta
// ---------------------------------------------------------------------------
function trocar(rotulo, trocas) {
  let sql = SQL_8E;
  for (const [de, para] of trocas) {
    assert.ok(
      sql.includes(de),
      `${rotulo}: o trecho a mutar não existe: ${de}`,
    );
    const novo = sql.replace(de, () => para);
    assert.notEqual(novo, sql);
    sql = novo;
  }
  return sql;
}
/** Com o mutante, um POSITIVO deixa de ser positivo (a prova ficaria vermelha). */
async function mutantePositivo(rotulo, trocas, montar) {
  const {
    saidas: [real, mutante],
  } = await noEstado(montar, [SQL_8E, trocar(rotulo, trocas)]);
  await exigirPositiva(`${rotulo} (consulta real)`, real);
  let pego = false;
  try {
    await exigirPositiva(`mutante ${rotulo}`, mutante);
  } catch (e) {
    pego = true;
    assert.ok(e instanceof assert.AssertionError, String(e));
  }
  assert.ok(pego, `${rotulo}: o MUTANTE do caso positivo passou despercebido`);
}
/** Com o mutante, um NEGATIVO deixa de reprovar o que devia (e fica MAIS verde). */
async function mutanteNegativo(rotulo, trocas, montar, esperadas) {
  const {
    saidas: [real, mutante],
  } = await noEstado(montar, [SQL_8E, trocar(rotulo, trocas)]);
  await exigirReprovadas(`${rotulo} (consulta real)`, real, esperadas);
  let pego = false;
  try {
    await exigirReprovadas(`mutante ${rotulo}`, mutante, esperadas);
  } catch (e) {
    pego = true;
    assert.ok(e instanceof assert.AssertionError, String(e));
  }
  assert.ok(pego, `${rotulo}: o MUTANTE passou despercebido`);
  assert.ok(
    reprovadas(mutante).length < reprovadas(real).length,
    `${rotulo}: o mutante não afrouxou nada`,
  );
}

// ---------------------------------------------------------------------------
async function main() {
  conferirLista();
  PORTAO = await import(
    pathToFileURL(path.join(REPO, "scripts", "frota", "publicar-release.mjs"))
      .href
  );
  C = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await C.connect();
  // O papel só-leitura é do CLUSTER; nome único, removido no finally.
  await C.query(`CREATE ROLE ${RO} NOLOGIN BYPASSRLS`);
  try {
    await C.query(`GRANT pg_read_all_data TO ${RO}`);
    await provar();
  } finally {
    await C.query("ROLLBACK").catch(() => {});
    await C.query(`DROP ROLE IF EXISTS ${RO}`).catch(() => {});
    await C.end().catch(() => {});
  }
  console.log(`\nportao-8e-aceita-sucessoras-viva: ${resultados} ok`);
}

async function provar() {
  // ------------------------------------------------------------- POSITIVOS
  const respostas = [];
  for (const [rotulo, montar] of ESTADOS) {
    const { rows } = await noEstado(montar);
    await exigirPositiva(rotulo, rows);
    respostas.push(rows);
    ok(
      `positiva — ${rotulo}: ${rows.length}/${N} linhas ok=true, rol exato, portão POSITIVA, pré-checagem do ledger aceita`,
    );
  }
  for (const rows of respostas.slice(1))
    assert.deepEqual(rows, respostas[0], "os onze estados respondem igual");
  ok(
    "os onze estados (árvore, 99, painel na 12, analytics na 14, crm na 27, só 14+34, só 27+32, só 30, só 31, só 35, só 39) dão a MESMA resposta linha a linha (o vivo aceito mostra o esperado = hash da 99)",
  );

  // ------------------------------------------------------------- NEGATIVOS
  for (const s of FUNCOES) {
    const aceitos = aceitosDe(s);
    {
      const { rows, montado: h } = await noEstado(
        em(ARVORE, corpoEstranho(s.assinatura, aceitos)),
      );
      await exigirReprovadas(`${fnDe(s)} estranho`, rows, [item(s)]);
      assert.equal(
        linha(rows, item(s)).vivo,
        h,
        "o vivo mostra o md5 estranho",
      );
      assert.equal(linha(rows, item(s)).esperado, h99(s));
    }
    {
      const { rows } = await noEstado(em(ARVORE, ausente(s)));
      await exigirReprovadas(`${fnDe(s)} ausente`, rows, [item(s)]);
      assert.equal(linha(rows, item(s)).vivo, "AUSENTE");
    }
    {
      const { rows } = await noEstado(em(ARVORE, sobrecarga(s)));
      await exigirReprovadas(`${fnDe(s)} sobrecarga`, rows, [item(s)]);
      assert.equal(
        linha(rows, item(s)).vivo,
        `${s.hashDesta},${s.hashDesta}`,
        "a sobrecarga sai como os dois md5 com vírgula",
      );
    }
    {
      const { rows } = await noEstado(em(ARVORE, corpoDaOutra(s)));
      await exigirReprovadas(`${fnDe(s)} com o corpo da outra`, rows, [
        item(s),
      ]);
      assert.equal(linha(rows, item(s)).vivo, OUTRA.get(s).hashDesta);
    }
    {
      const { rows } = await noEstado(
        em(ESTADO_99, corpoEstranho(s.assinatura, aceitos)),
      );
      await exigirReprovadas(`${fnDe(s)} estranho no estado 99`, rows, [
        item(s),
      ]);
    }
    {
      const { rows } = await noEstado(em(ESTADO_99, ausente(s)));
      await exigirReprovadas(`${fnDe(s)} ausente no estado 99`, rows, [
        item(s),
      ]);
    }
    ok(
      `negativo — ${fnDe(s)}: corpo estranho, AUSENTE, sobrecarga com o mesmo corpo e o corpo da sucessora da outra função reprovam SÓ "${item(s)}" (árvore e estado 99); portão NEGATIVA, pré-checagem lança`,
    );
  }
  // Os mistos: a função que ficou na 99 (ou no intermediário) e a que está na sucessora, cada uma por si.
  {
    const { rows } = await noEstado(em(PAINEL_NA_12, ausente(ANALYTICS)));
    await exigirReprovadas("painel na 12 + analytics ausente", rows, [
      item(ANALYTICS),
    ]);
    const r2 = await noEstado(
      em(PAINEL_NA_12, corpoEstranho(PAINEL.assinatura, aceitosDe(PAINEL))),
    );
    await exigirReprovadas("painel na 12 + painel estranho", r2.rows, [
      item(PAINEL),
    ]);
    const r2b = await noEstado(
      em(
        ANALYTICS_NA_14,
        corpoEstranho(ANALYTICS.assinatura, aceitosDe(ANALYTICS)),
      ),
    );
    await exigirReprovadas("analytics na 14 + analytics estranho", r2b.rows, [
      item(ANALYTICS),
    ]);
    const r2c = await noEstado(em(ANALYTICS_NA_14, ausente(PAINEL)));
    await exigirReprovadas("analytics na 14 + painel ausente", r2c.rows, [
      item(PAINEL),
    ]);
    const r3 = await noEstado(em(SO_14, sobrecarga(ANALYTICS)));
    await exigirReprovadas("só 14 + sobrecarga do analytics", r3.rows, [
      item(ANALYTICS),
    ]);
    const r4 = await noEstado(em(SO_14, ausente(PAINEL)));
    await exigirReprovadas("só 14 + painel ausente", r4.rows, [item(PAINEL)]);
    const r5 = await noEstado(em(SO_27, sobrecarga(CRM)));
    await exigirReprovadas("só 27 + sobrecarga do crm_visao", r5.rows, [
      item(CRM),
    ]);
    const r6 = await noEstado(em(SO_27, ausente(PAINEL)));
    await exigirReprovadas("só 27 + painel ausente", r6.rows, [item(PAINEL)]);
    const r7 = await noEstado(em(SO_30, sobrecarga(CLIENTES)));
    await exigirReprovadas("só 30 + sobrecarga da tela Clientes", r7.rows, [
      item(CLIENTES),
    ]);
    const r8 = await noEstado(em(SO_30, ausente(CRMC)));
    await exigirReprovadas("só 30 + crm_clientes ausente", r8.rows, [
      item(CRMC),
    ]);
    const r9 = await noEstado(
      em(SO_31, corpoEstranho(CRMC.assinatura, aceitosDe(CRMC))),
    );
    await exigirReprovadas("só 31 + crm_clientes estranho", r9.rows, [
      item(CRMC),
    ]);
    const r10 = await noEstado(em(SO_31, ausente(CLIENTES)));
    await exigirReprovadas("só 31 + tela Clientes ausente", r10.rows, [
      item(CLIENTES),
    ]);
    const r11 = await noEstado(em(SO_35, sobrecarga(VENDA)));
    await exigirReprovadas("só 35 + sobrecarga da venda do balcão", r11.rows, [
      item(VENDA),
    ]);
    const r12 = await noEstado(em(SO_35, ausente(PAINEL)));
    await exigirReprovadas("só 35 + painel ausente", r12.rows, [item(PAINEL)]);
    const r13 = await noEstado(
      em(SO_35, corpoEstranho(VENDA.assinatura, aceitosDe(VENDA))),
    );
    await exigirReprovadas("só 35 + venda do balcão estranha", r13.rows, [
      item(VENDA),
    ]);
    const r14 = await noEstado(em(SO_39, sobrecarga(UPSERT)));
    await exigirReprovadas(
      "só 39 + sobrecarga do upsert_store_config",
      r14.rows,
      [item(UPSERT)],
    );
    const r15 = await noEstado(em(SO_39, ausente(PAINEL)));
    await exigirReprovadas("só 39 + painel ausente", r15.rows, [item(PAINEL)]);
    const r16 = await noEstado(
      em(SO_39, corpoEstranho(UPSERT.assinatura, aceitosDe(UPSERT))),
    );
    await exigirReprovadas("só 39 + upsert_store_config estranho", r16.rows, [
      item(UPSERT),
    ]);
    const r17 = await noEstado(
      em(CRM_NA_27, corpoEstranho(CRM.assinatura, aceitosDe(CRM))),
    );
    await exigirReprovadas("crm na 27 + crm estranho", r17.rows, [item(CRM)]);
    const r18 = await noEstado(em(CRM_NA_27, sobrecarga(CRM_27)));
    await exigirReprovadas("crm na 27 + sobrecarga do crm_visao", r18.rows, [
      item(CRM),
    ]);
    const r19 = await noEstado(em(CRM_NA_27, ausente(PAINEL)));
    await exigirReprovadas("crm na 27 + painel ausente", r19.rows, [
      item(PAINEL),
    ]);
  }
  ok(
    "negativo — nos estados MISTOS (painel na 12, analytics na 14, crm na 27, só 14+34, só 27+32, só 30, só 31, só 35, só 39) a função ausente, estranha ou sobrecarregada reprova SÓ a linha dela",
  );
  // Controle: as outras 54 seguem exatas (agora a upsert_store_config TEM sucessora; o controle e a save_store_identity).
  {
    const { rows } = await noEstado(async (c) => {
      await ARVORE(c);
      const r = await c.query(
        `SELECT p.oid::regprocedure::text AS a FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
          WHERE ns.nspname = 'public' AND p.proname = 'save_store_identity'`,
      );
      assert.equal(r.rows.length, 1);
      return corpoEstranho(r.rows[0].a, [])(c);
    });
    await exigirReprovadas("save_store_identity estranho", rows, [
      "corpo final save_store_identity",
    ]);
  }
  ok(
    "controle — uma das outras 54 (save_store_identity) com corpo estranho reprova só ela: nada além das sete funções com sucessora foi afrouxado",
  );

  // ------------------------------------------------------------- MUTANTES
  const zero = "0".repeat(32);
  // cada elo da cadeia, no estado em que ELE é o corpo vivo
  for (const s of SUCESSORAS_DA_99) {
    await mutantePositivo(
      `hash da sucessora ${s.nome.slice(0, 14)} de ${fnDe(s)} trocado`,
      [[`('${fnDe(s)}', '${s.hashDesta}', `, `('${fnDe(s)}', '${zero}', `]],
      s === PAINEL_12
        ? PAINEL_NA_12
        : s === ANALYTICS_14
          ? ANALYTICS_NA_14
          : s === CRM_27
            ? CRM_NA_27
            : ARVORE,
    );
  }
  for (const s of FUNCOES)
    await mutantePositivo(
      `hash da 99 de ${fnDe(s)} trocado no final`,
      [[`('${fnDe(s)}', '${h99(s)}')`, `('${fnDe(s)}', '${zero}')`]],
      ESTADO_99,
    );
  await mutantePositivo(
    "aceitos removidos (sem o OR da sucessora)",
    [[" OR c.h IN (SELECT s.h FROM sucessoras s WHERE s.fn = f.fn)", ""]],
    ARVORE,
  );
  await mutantePositivo(
    "aceitos removidos (CTE sucessoras sem as dez)",
    SUCESSORAS_DA_99.map((s) => [
      `('${fnDe(s)}', '${s.hashDesta}', '${s.nome.slice(0, 14)}')`,
      `('nenhuma_${s.nome.slice(0, 14)}', '${zero}', '${s.nome.slice(0, 14)}')`,
    ]),
    ARVORE,
  );
  await mutanteNegativo(
    "aceito de qualquer função (sem s.fn = f.fn)",
    [[" WHERE s.fn = f.fn) THEN f.h", ") THEN f.h"]],
    em(ARVORE, corpoDaOutra(PAINEL)),
    [item(PAINEL)],
  );
  await mutanteNegativo(
    "AUSENTE aceito",
    [["WHEN c.h IS NULL THEN 'AUSENTE'", "WHEN c.h IS NULL THEN f.h"]],
    em(ARVORE, ausente(ANALYTICS)),
    [item(ANALYTICS)],
  );
  await mutanteNegativo(
    "corpo estranho aceito",
    [["ELSE c.h END\n    FROM final f", "ELSE f.h END\n    FROM final f"]],
    em(ARVORE, corpoEstranho(PAINEL.assinatura, aceitosDe(PAINEL))),
    [item(PAINEL)],
  );
  await mutanteNegativo(
    "sobrecarga aceita (sem o string_agg)",
    [
      [
        "string_agg(md5(replace(p.prosrc, E'\\r', '')), ',' ORDER BY md5(replace(p.prosrc, E'\\r', '')))",
        "min(md5(replace(p.prosrc, E'\\r', '')))",
      ],
    ],
    em(ARVORE, sobrecarga(PAINEL)),
    [item(PAINEL)],
  );
  ok(
    "MUTANTES do texto da 8e: hash de cada elo da cadeia trocado (12, 28, 14, 34, 27, 32, 30, 31, 35 e 39, cada um no estado em que ele é o vivo), hash da 99 trocado (cada função), aceitos removidos (sem o OR e com o CTE vazio), aceito de qualquer função, AUSENTE aceito, corpo estranho aceito e sobrecarga aceita — todos pegos, a prova ficaria VERMELHA",
  );
}

main().catch((erro) =>
  falhar("PORTAO-8E", erro?.stack ? erro.stack : String(erro)),
);
