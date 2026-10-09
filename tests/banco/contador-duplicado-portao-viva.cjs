"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para a migration 20261207000000 (a
 * coluna duplicada de contagem de uso do cupom, `coupons.used_count`, e apagada), num
 * Postgres EFEMERO local -- nada de rede, nada de loja:
 *   14a-conferir-contador-duplicado-apagado.sql                       (DEPOIS do apply: 4 linhas)
 *   14b-antes-contador-duplicado-coluna-presente-e-zerada.sql         (ANTES do apply: 13 linhas)
 * Elas sao a "prova de objetos" do lote 20261207000000 em scripts/frota/canais-de-backend.json:
 * sem elas o portao (scripts/frota/publicar-release.mjs) bloqueia a release com esta migration
 * nova. Esta prova diz que cada consulta DECIDE certo -- nao que a IKCOUS ou a Savy estao no
 * estado A ou B (isso so o run da consulta contra o ref de cada loja diz).
 *
 * DIFERENCA PARA O PRECEDENTE (cupom preso, 12a/12b): la a consulta do ANTES prova que objetos
 * NAO existem; aqui ela prova o CONTRARIO -- a coluna PRESENTE e zerada, sem dependentes. O
 * mecanismo do portao (`decidirLote`) nao muda: so exige que a consulta do ANTES seja POSITIVA
 * (todas as linhas ok, rol=ok), da mesma janela ou mais nova que a do lote NEGATIVA; o que ela
 * mede e' problema da consulta. A ponta a ponta abaixo prova que isso fecha em APLICAR / NADA /
 * PARAR com o lote real do canais-de-backend.json.
 *
 * COMO RODA: cada defeito num banco CLONADO (`CREATE DATABASE ... TEMPLATE`) que some no fim; a
 * consulta sempre como papel de LEITURA nao superusuario (LOGIN BYPASSRLS + pg_read_all_data,
 * read-only por padrao, imitando o supabase_read_only_user). Cada veredito e' levado ate o
 * PORTAO de verdade (`evidenciaDaProva` e `decidirLote`): "positiva" aqui quer dizer POSITIVA
 * para o portao, com `rol=ok`; "reprova" quer dizer NEGATIVA (nunca POSITIVA).
 *
 * BASES: `pre` (a arvore SEM a 20261207000000, tres cupons com used_count = 0); `aplicado` (`pre` +
 * o ARQUIVO aplicado de verdade, LF); `crlf` (o texto da migration com CRLF, como num checkout
 * Windows).
 *
 * CASOS (cada um com a LINHA exata que reprova; o veredito real, com rol=ok e o ok_false esperado,
 * e' conferido em TODO caso):
 *  14b POSITIVOS  em `pre`; com o papel minimo (so SELECT em coupons) e com search_path vazio.
 *  14b NEGATIVOS  valor 3; NULL; coluna GERADA que cita used_count (so a linha dos dependentes);
 *                 visao, politica e gatilho que a citam (dependentes + a linha do texto); indice
 *                 (dependentes); funcao que a cita (so a linha das funcoes); forma diferente do
 *                 baseline; usage_count ausente ou em outra forma (bigint, sem default, NOT NULL); o
 *                 papel que SOFRE a RLS e nao ve a linha com valor 3
 *                 (reprova a linha da RLS: o "tudo zero" dele nao vale); coluna JA apagada (`aplicado`:
 *                 as linhas dizem AUSENTE, nunca "todas as linhas").
 *  14a POSITIVOS  em `aplicado` e `crlf` (IGUAIS ao `cheio`, a arvore inteira, linha a linha).
 *  14a NEGATIVOS  coluna ainda presente (`pre`, e depois do rollback); usage_count com outro tipo,
 *                 sem default, NOT NULL ou ausente; a tabela coupons ausente. A 14a NAO trava corpo
 *                 de funcao (a migration nao toca funcao; a 10a e a 12a travam os delas): a prova
 *                 confere que uma funcao de cupom alterada NAO a reprova.
 *  MUTANTES       cada linha da consulta ignorada e cada clausula composta desligada no texto do
 *                 .sql (a exclusao so do default da PROPRIA coluna: voltar a excluir todo pg_attrdef
 *                 esconde a coluna gerada; nao excluir nada reprova o positivo; o guarda AUSENTE da
 *                 contagem) deixa um caso PASSAR e esta prova ficaria
 *                 VERMELHA -- a saida vermelha de cada um e' impressa.
 *  FECHADO        resposta PARCIAL e linha duplicada tem rol=invalido: o portao NUNCA as trata como
 *                 positivas; o rol de uma consulta nao vale para a outra.
 *  ERRO           SQL truncado (42601) e banco inexistente: falha ALTA, nenhuma linha
 *                 VEREDITO-CONSULTA, o portao fica SEM_EVIDENCIA mesmo com o run verde.
 *  PONTA A PONTA  conferir-banco.cjs de verdade (processo filho, HTTP local) e o LOTE do
 *                 canais-de-backend.json REAL no `decidirLote`: ledger sem a versao + 14a NEGATIVA +
 *                 14b POSITIVA -> APLICAR [20261207000000]; 14b NEGATIVA (valor 3) -> PARAR; 14a
 *                 POSITIVA + ledger com a versao -> NADA; 14a POSITIVA sem a versao no ledger -> PARAR.
 *
 * LIMITES DECLARADOS: (1) o Postgres e' o 17 LOCAL; o papel de leitura real da loja
 * (supabase_read_only_user) e o Postgres 15/17 da Supabase nao foram medidos aqui. (2) A linha
 * "controle: funcoes de public visiveis" nao tem negativo nesta prova (o catalogo pg_proc e' legivel
 * por todo papel; nao ha como esvazia-lo localmente); ela fica sem mutante. (3) Uma gravacao em
 * used_count entre a 14b e o apply nao e' vista pela 14b: quem fecha essa janela e' o pre-voo da
 * migration (tests/banco/contador-duplicado-viva.cjs).
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres:...@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/contador-duplicado-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (a pasta de consultas, as migrations e o
 * publicar-release.mjs), nunca de entrada de rede; as chaves de objeto vem de constantes e
 * mapas fechados deste arquivo (nomes das consultas, das linhas e dos bancos de teste). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn, spawnSync } = require("node:child_process");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
process.chdir(REPO);
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);

const A = "14a-conferir-contador-duplicado-apagado";
const B = "14b-antes-contador-duplicado-coluna-presente-e-zerada";
const V = "20261207000000";
const ARQ = "20261207000000_o_contador_duplicado_do_cupom_morre.sql";
const ARQ_RB = `rollback-manual-${ARQ}`;
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const SHA40 = "d".repeat(40);
const SQL = {
  [A]: fs.readFileSync(path.join(CONSULTAS, `${A}.sql`), "utf8"),
  [B]: fs.readFileSync(path.join(CONSULTAS, `${B}.sql`), "utf8"),
};
const ROL = { [A]: CONF.ROL_DA_14A, [B]: CONF.ROL_DA_14B };
const N_LINHAS = { [A]: 4, [B]: 13 };
const SIG_VAL = "public.validate_coupon_secure_v2(text,numeric)";

// Os nomes das linhas (o rol fechado do codigo tem os mesmos).
const CONTROLE = "controle: funcoes de public visiveis a este papel";
const USAGE_FORMA =
  "coupons.usage_count: forma do baseline (integer, aceita NULL, DEFAULT 0)";
const LA = {
  controle: CONTROLE,
  tabela: "public.coupons: tabela",
  coluna: "coupons.used_count: coluna",
  usage: USAGE_FORMA,
};
const LB = {
  controle: CONTROLE,
  presente: "coupons.used_count: coluna presente",
  forma:
    "coupons.used_count: forma do baseline (integer, aceita NULL, DEFAULT 0)",
  usage: USAGE_FORMA,
  rls: "public.coupons: a seguranca por linha vale para este papel",
  acl: "coupons.used_count: permissao propria por coluna (attacl)",
  cmt: "coupons.used_count: comentario proprio",
  linhas: "coupons.used_count: linhas com valor diferente de 0 (NULL conta)",
  dep: "coupons.used_count: dependentes (fora o default da propria coluna)",
  fn: "funcoes de qualquer schema que citam used_count",
  pol: "politicas de public que citam used_count",
  gat: "gatilhos que citam used_count",
  vis: "visoes de public que citam used_count",
};

const ordena = (l) => [...l].sort();
const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const P = {
  ro: `cdp_ro_${SUF}`, // LOGIN BYPASSRLS + pg_read_all_data: imita o supabase_read_only_user
  minimo: `cdp_min_${SUF}`, // NOLOGIN BYPASSRLS, so SELECT em coupons
  cego: `cdp_cego_${SUF}`, // pg_read_all_data SEM BYPASSRLS: a RLS o deixa sem cupom
};

const urlBase = lerDatabaseUrlEfemera();
const urlDe = (db) => {
  const u = new URL(urlBase);
  u.pathname = `/${db}`;
  return u.toString();
};
async function usar(db, fn) {
  const c = new Client({ connectionString: urlDe(db) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => {});
  }
}
const clones = [];
async function clonar(rotulo, de) {
  const nome = `cdp_${SUF}_${clones.length}_${rotulo}`.slice(0, 60);
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      await usar("template1", (a) =>
        a.query(`CREATE DATABASE "${nome}" TEMPLATE "${de}"`),
      );
      break;
    } catch (e) {
      // 55006: o molde ainda esta sendo liberado pela conexao que acabou de fechar.
      if (e.code !== "55006" || tentativa >= 20) throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  clones.push(nome);
  return nome;
}
let resultados = 0;
function ok(msg) {
  resultados += 1;
  console.log(`  ok ${resultados}. ${msg}`);
}
function rodarScriptNode(argv, env) {
  const r = spawnSync(process.execPath, argv, { env, encoding: "utf8" });
  assert.equal(
    r.status,
    0,
    `${path.basename(argv[0])} falhou:\n${(r.stdout || "").slice(-600)}\n${(r.stderr || "").slice(-600)}`,
  );
}
async function montarBase(nome, filtro) {
  await usar("template1", (a) => a.query(`CREATE DATABASE "${nome}"`));
  clones.push(nome);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-"));
  try {
    for (const e of fs.readdirSync(MIGRATIONS, { withFileTypes: true })) {
      if (
        e.isFile() &&
        e.name.endsWith(".sql") &&
        !e.name.startsWith("rollback-") &&
        filtro(e.name)
      )
        fs.copyFileSync(path.join(MIGRATIONS, e.name), path.join(dir, e.name));
    }
    const env = { ...process.env, DATABASE_URL: urlDe(nome) };
    rodarScriptNode([path.join(__dirname, "provisionar.cjs")], env);
    rodarScriptNode([path.join(__dirname, "aplicar-migrations.cjs"), dir], env);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
/** Aplica, num banco ja existente, UM arquivo (com o fim de linha pedido), pelo mesmo script do rpc-ci.yml. */
function aplicarArquivo(db, arquivo, { crlf = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-ap-"));
  try {
    let texto = fs
      .readFileSync(path.join(MIGRATIONS, arquivo), "utf8")
      .replace(/\r\n/g, "\n");
    if (crlf) texto = texto.replace(/\n/g, "\r\n");
    fs.writeFileSync(path.join(dir, arquivo), texto);
    rodarScriptNode([path.join(__dirname, "aplicar-migrations.cjs"), dir], {
      ...process.env,
      DATABASE_URL: urlDe(db),
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
/** Uma mutacao SEGUIDA de uma guarda que da RAISE se ela nao aplicou. */
async function mutar(db, rotulo, sql, guarda) {
  await usar(db, async (c) => {
    await c.query(sql);
    const g = await c.query(`SELECT COALESCE((${guarda}), false) AS ok`);
    assert.ok(g.rows[0].ok, `a mutacao nao aplicou: ${rotulo}`);
  });
}
/** Reescreve o CORPO de uma funcao mantendo cabecalho, atributos e ACL. */
async function reescreverCorpo(db, assinatura, transformar) {
  await usar(db, async (c) => {
    const def = (
      await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
        assinatura,
      ])
    ).rows[0].d;
    const i = def.indexOf("$function$");
    const j = def.lastIndexOf("$function$");
    assert.ok(i > 0 && j > i, "pg_get_functiondef sem $function$");
    const corpo = def.slice(i + "$function$".length, j);
    await c.query(
      def.slice(0, i + "$function$".length) + transformar(corpo) + def.slice(j),
    );
  });
}

// ---------------------------------------------------------------------------
// Rodar a consulta
// ---------------------------------------------------------------------------
async function rodar(db, consulta, { papel = P.ro, sql, antes = [] } = {}) {
  const texto = sql ?? SQL[consulta];
  assert.equal(CONF.contarStatements(texto), 1, "exatamente 1 statement");
  return usar(db, async (c) => {
    for (const a of antes) await c.query(a);
    if (papel) await c.query(`SET ROLE ${papel}`);
    await c.query("SET default_transaction_read_only = on");
    try {
      assert.equal(
        (await c.query("SHOW transaction_read_only")).rows[0]
          .transaction_read_only,
        "on",
      );
      const r = await c.query(texto);
      assert.deepEqual(
        r.fields.map((f) => f.name),
        ["item", "esperado", "vivo", "ok"],
        "colunas item/esperado/vivo/ok",
      );
      return r.rows;
    } finally {
      if (papel) await c.query("RESET ROLE").catch(() => {});
    }
  });
}
async function tentar(db, consulta, opcoes) {
  try {
    return { rows: await rodar(db, consulta, opcoes) };
  } catch (erro) {
    return { erro };
  }
}
const reprovadas = (rows) =>
  rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item)
    .sort();
function linha(rows, item) {
  const l = rows.filter((r) => r.item === item);
  assert.equal(l.length, 1, `esperava 1 linha de "${item}", achei ${l.length}`);
  return l[0];
}

// ---------------------------------------------------------------------------
// O PORTAO
// ---------------------------------------------------------------------------
let PORTAO;
let relogio = Date.parse("2026-10-09T12:00:00Z");
async function portaoComLog(consulta, linhaDeVeredito, conclusao = "success") {
  relogio += 1000;
  return PORTAO.evidenciaDaProva({
    consulta,
    projeto: "savy",
    ref: REF_SAVY,
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
                displayTitle: `conferir ${consulta} em savy`,
                headSha: SHA40,
                createdAt: new Date(relogio).toISOString(),
                conclusion: conclusao,
                status: "completed",
              },
            ]
          : [],
      logDoRun: async () => `saida do job\n${linhaDeVeredito ?? ""}\n`,
      arvoreIgual: async () => true,
    },
  });
}
const veredito = (consulta, rows) =>
  CONF.veredictoDaConsulta({
    consulta,
    ref: REF_SAVY,
    sha: SHA40,
    linhas: rows,
  });
async function estadoNoPortao(consulta, rows) {
  return (await portaoComLog(consulta, veredito(consulta, rows))).estado;
}
function exigirFormato(consulta, rotulo, rows) {
  assert.equal(rows.length, N_LINHAS[consulta], `${rotulo}: n de linhas`);
  assert.equal(
    CONF.estruturaDoRolFechado(rows, ROL[consulta]),
    null,
    `${rotulo}: o rol fechado do codigo tem de ser EXATAMENTE o que a consulta devolveu`,
  );
  for (const r of rows) {
    assert.equal(typeof r.ok, "boolean", `${rotulo}: ok nao booleano`);
    assert.deepEqual(
      [typeof r.item, typeof r.esperado, typeof r.vivo],
      ["string", "string", "string"],
      `${rotulo}: item/esperado/vivo tem de ser texto`,
    );
  }
  const oks = rows.map((r) => r.ok);
  assert.deepEqual(
    oks,
    [...oks].sort((a, b) => Number(a) - Number(b)),
    `${rotulo}: ok=false primeiro`,
  );
}
async function exigirPositiva(consulta, rotulo, rows) {
  exigirFormato(consulta, rotulo, rows);
  assert.deepEqual(reprovadas(rows), [], `${rotulo}: nada podia reprovar`);
  const v = veredito(consulta, rows);
  assert.ok(
    v.endsWith(
      `linhas=${N_LINHAS[consulta]} ok_false=0 ok_nao_booleano=0 rol=ok`,
    ),
    `${rotulo}: veredito ${v}`,
  );
  assert.equal(await estadoNoPortao(consulta, rows), "POSITIVA", rotulo);
}
async function exigirReprovadas(consulta, rotulo, rows, esperadas) {
  exigirFormato(consulta, rotulo, rows);
  assert.deepEqual(
    reprovadas(rows),
    ordena(esperadas),
    `${rotulo}: reprovou ${JSON.stringify(reprovadas(rows))}, esperava ${JSON.stringify(ordena(esperadas))}`,
  );
  const v = veredito(consulta, rows);
  assert.ok(
    v.endsWith(
      `linhas=${N_LINHAS[consulta]} ok_false=${esperadas.length} ok_nao_booleano=0 rol=ok`,
    ),
    `${rotulo}: veredito ${v}`,
  );
  assert.equal(await estadoNoPortao(consulta, rows), "NEGATIVA", rotulo);
}
async function negativo(consulta, rotulo, db, esperadas, opcoes = {}) {
  const rows = await rodar(db, consulta, opcoes);
  await exigirReprovadas(consulta, rotulo, rows, esperadas);
  return rows;
}
function aplicarTrocas(rotulo, consulta, trocas) {
  let sql = SQL[consulta];
  for (const [de, para] of trocas) {
    assert.ok(
      sql.includes(de),
      `${rotulo}: o trecho a mutar nao existe: ${de}`,
    );
    const novo = sql.replace(de, () => para);
    assert.notEqual(novo, sql);
    sql = novo;
  }
  return sql;
}
function imprimeVermelho(rotulo, e) {
  assert.ok(e instanceof assert.AssertionError, String(e));
  console.log(
    `     mutante "${rotulo}" -> VERMELHO: ${String(e.message).split("\n")[0].slice(0, 220)}`,
  );
}
/** Um MUTANTE do texto do .sql tem de ser PEGO: com ele, o negativo `db` deixa de reprovar o que devia. */
async function mutanteTemQueSerPego(
  rotulo,
  consulta,
  trocas,
  db,
  esperadas,
  opcoes = {},
) {
  const sql = aplicarTrocas(rotulo, consulta, trocas);
  const rows = await rodar(db, consulta, { ...opcoes, sql });
  let pego = false;
  try {
    await exigirReprovadas(consulta, `mutante ${rotulo}`, rows, esperadas);
  } catch (e) {
    pego = true;
    imprimeVermelho(rotulo, e);
  }
  assert.ok(pego, `${rotulo}: o MUTANTE passou despercebido`);
  const real = await rodar(db, consulta, opcoes);
  assert.ok(
    reprovadas(rows).length < reprovadas(real).length,
    `${rotulo}: o mutante nao afrouxou nada`,
  );
}
async function mutantePositivoTemQueSerPego(
  rotulo,
  consulta,
  trocas,
  db,
  opcoes = {},
) {
  const sql = aplicarTrocas(rotulo, consulta, trocas);
  const rows = await rodar(db, consulta, { ...opcoes, sql });
  let pego = false;
  try {
    await exigirPositiva(consulta, `mutante ${rotulo}`, rows);
  } catch (e) {
    pego = true;
    imprimeVermelho(rotulo, e);
  }
  assert.ok(pego, `${rotulo}: o MUTANTE do caso positivo passou despercebido`);
}
/** Mutante cuja diferenca nao esta no conjunto de linhas reprovadas, e sim no que uma linha DIZ. */
async function mutanteComChecagem(
  rotulo,
  consulta,
  trocas,
  db,
  checagem,
  opcoes = {},
) {
  const sql = aplicarTrocas(rotulo, consulta, trocas);
  const rows = await rodar(db, consulta, { ...opcoes, sql });
  let pego = false;
  try {
    checagem(rows);
  } catch (e) {
    pego = true;
    imprimeVermelho(rotulo, e);
  }
  assert.ok(pego, `${rotulo}: o MUTANTE passou despercebido`);
}
function textoDaLinha(consulta, item) {
  const sql = SQL[consulta];
  const ini = sql.indexOf(`SELECT '${item}',`);
  assert.ok(ini >= 0, `a linha "${item}" nao existe na ${consulta}`);
  assert.equal(
    sql.indexOf(`SELECT '${item}',`, ini + 1),
    -1,
    `a linha "${item}" aparece mais de uma vez`,
  );
  const resto = sql.slice(ini);
  const fim = resto.search(/\n {2}(?:UNION ALL|-- )|\n\)\nSELECT item/);
  assert.ok(fim > 0, `nao achei o fim da linha "${item}"`);
  return resto.slice(0, fim);
}
function mutanteDaLinha(rotulo, consulta, item, db, esperadas, opcoes = {}) {
  return mutanteTemQueSerPego(
    rotulo,
    consulta,
    [[textoDaLinha(consulta, item), `SELECT '${item}', 'x', 'x'`]],
    db,
    esperadas,
    opcoes,
  );
}

// o bloco da exclusao do default da PROPRIA coluna, na 14b (item "dependentes")
const EXCLUSAO_14B = `     AND NOT (
       d.classid = 'pg_attrdef'::regclass
       AND EXISTS (
         SELECT 1 FROM pg_attrdef ad
          WHERE ad.oid = d.objid
            AND ad.adrelid = d.refobjid
            AND ad.adnum = d.refobjsubid
       )
     )`;
// o filtro de schema da linha das funcoes, na 14b
const FILTRO_FN_14B = `   WHERE s.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')\n     AND strpos(`;
const GUARDA_AUSENTE_LINHAS = `CASE WHEN NOT EXISTS (SELECT 1 FROM col) THEN 'AUSENTE'
              ELSE (SELECT count(*)::text FROM public.coupons c
                     WHERE (to_jsonb(c) -> 'used_count') IS DISTINCT FROM '0'::jsonb) END`;

// ---------------------------------------------------------------------------
// ponta a ponta: conferir-banco.cjs (processo filho de verdade) x servidor local
// ---------------------------------------------------------------------------
function subirApi() {
  const estado = { db: null, papel: P.ro };
  const srv = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (d) => (corpo += d));
    req.on("end", async () => {
      const query = JSON.parse(corpo).query;
      try {
        const c = new Client({ connectionString: urlDe(estado.db) });
        await c.connect();
        try {
          await c.query(`SET ROLE ${estado.papel}`);
          await c.query("SET default_transaction_read_only = on");
          const r = await c.query(query);
          res.writeHead(201, {
            "content-type": "application/json",
            connection: "close",
          });
          res.end(JSON.stringify(r.rows ?? []));
        } finally {
          await c.end().catch(() => {});
        }
      } catch (erro) {
        res.writeHead(400, {
          "content-type": "application/json",
          connection: "close",
        });
        res.end(JSON.stringify({ message: String(erro.message) }));
      }
    });
  });
  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () =>
      resolve({
        estado,
        base: `http://127.0.0.1:${srv.address().port}`,
        parar: () => new Promise((r) => srv.close(r)),
      }),
    ),
  );
}
function rodarScript(env) {
  return new Promise((resolve) => {
    const filho = spawn(
      process.execPath,
      [path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs")],
      {
        env: {
          PATH: process.env.PATH,
          ...(process.env.SystemRoot
            ? { SystemRoot: process.env.SystemRoot }
            : {}),
          GITHUB_STEP_SUMMARY: "",
          ...env,
        },
      },
    );
    let saida = "";
    filho.stdout.on("data", (d) => (saida += d));
    filho.stderr.on("data", (d) => (saida += d));
    filho.on("close", (codigo) => resolve({ codigo, saida }));
  });
}

async function main() {
  PORTAO = await import(
    pathToFileURL(path.join(REPO, "scripts", "frota", "publicar-release.mjs"))
      .href
  );
  for (const c of [A, B]) {
    assert.ok(
      PORTAO.CONSULTAS_DE_ROL_FECHADO.has(c),
      `o portao tem de tratar ${c} como consulta de ROL FECHADO (so vale com rol=ok)`,
    );
    assert.equal(
      Object.entries(CONF.ROL_FECHADO_POR_CONSULTA).find(([n]) => n === c)?.[1],
      ROL[c],
    );
  }
  assert.deepEqual(
    Object.keys(CONF.ROL_FECHADO_POR_CONSULTA).sort(),
    [...PORTAO.CONSULTAS_DE_ROL_FECHADO].sort(),
  );
  assert.deepEqual(ordena(CONF.ROL_DA_14A), ordena(Object.values(LA)));
  assert.deepEqual(ordena(CONF.ROL_DA_14B), ordena(Object.values(LB)));

  // Os papeis sao do CLUSTER; a prova os cria (nomes unicos) e os remove no finally.
  await usar("template1", async (a) => {
    await a.query(`CREATE ROLE ${P.ro} LOGIN BYPASSRLS`);
    await a.query(`ALTER ROLE ${P.ro} SET default_transaction_read_only = on`);
    await a.query(`CREATE ROLE ${P.minimo} NOLOGIN BYPASSRLS`);
    await a.query(`CREATE ROLE ${P.cego} NOLOGIN`);
    await a.query(`GRANT pg_read_all_data TO ${P.ro}`);
    await a.query(`GRANT pg_read_all_data TO ${P.cego}`);
  });

  // ----------------------------------------------------------- bases
  const pre = `cdp_${SUF}_pre`;
  await montarBase(pre, (nome) => nome !== ARQ);
  await usar(pre, async (c) => {
    const eu = await c.query(
      "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
    );
    assert.equal(
      eu.rows[0].rolsuper,
      true,
      "precondicao: a conexao da prova e superusuario",
    );
    const col = await c.query(
      `SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.coupons'::regclass
        AND attname = 'used_count' AND NOT attisdropped`,
    );
    assert.equal(col.rows[0].n, 1, "precondicao: o estado pre TEM a coluna");
    await c.query(`INSERT INTO public.coupons (code, type, value, usage_limit, usage_count) VALUES
      ('CP1', 'fixed', 10, 5, 5), ('CP2', 'percentage', 15, NULL, 0), ('CP3', 'fixed', 3, 2, 2)`);
    await c.query(`GRANT USAGE ON SCHEMA public TO ${P.minimo}`);
    await c.query(`GRANT SELECT ON public.coupons TO ${P.minimo}`);
  });
  const aplicado = await clonar("aplicado", pre);
  aplicarArquivo(aplicado, ARQ);
  const crlf = await clonar("crlf", pre);
  aplicarArquivo(crlf, ARQ, { crlf: true });
  const cheioAntes = await rodar(aplicado, A);
  ok(
    "bases montadas: pre (arvore sem a 20261207, 3 cupons com used_count 0), aplicado (+ o ARQUIVO aplicado de verdade), crlf (texto com CRLF); o ARQUIVO aplica sem erro",
  );

  // ----------------------------------------------------------- 14b POSITIVOS
  {
    const rows = await rodar(pre, B);
    await exigirPositiva(B, "14b em pre", rows);
    assert.equal(linha(rows, LB.linhas).vivo, "0");
    assert.equal(linha(rows, LB.dep).vivo, "0");
    assert.equal(linha(rows, LB.fn).vivo, "(nenhuma)");
    await exigirPositiva(
      B,
      "14b papel minimo",
      await rodar(pre, B, { papel: P.minimo }),
    );
    await exigirPositiva(
      B,
      "14b search_path vazio",
      await rodar(pre, B, { antes: ["SET search_path = ''"] }),
    );
    ok(
      "14b POSITIVA em `pre` (coluna presente, forma do baseline, 0 linhas diferentes de 0, 0 dependentes, nada cita o nome, RLS nao vale), com o papel minimo (so SELECT em coupons) e com search_path vazio",
    );
  }

  // ----------------------------------------------------------- 14b NEGATIVOS
  const nb = {};
  const variante = async (rotulo, ddl, de = pre) => {
    const db = await clonar(rotulo, de);
    await usar(db, async (c) => {
      for (const sql of [].concat(ddl)) await c.query(sql);
    });
    nb[rotulo] = db;
    return db;
  };
  await variante(
    "valor",
    `UPDATE public.coupons SET used_count = 3 WHERE code = 'CP2'`,
  );
  await variante(
    "nulo",
    `UPDATE public.coupons SET used_count = NULL WHERE code = 'CP3'`,
  );
  await variante(
    "gerada",
    "ALTER TABLE public.coupons ADD COLUMN x integer GENERATED ALWAYS AS (used_count + 1) STORED",
  );
  await variante(
    "visao",
    "CREATE VIEW public.vw_prova AS SELECT code, used_count FROM public.coupons",
  );
  await variante(
    "politica",
    "CREATE POLICY pol_prova ON public.coupons FOR SELECT TO authenticated USING (used_count < 100)",
  );
  await variante("gatilho", [
    "CREATE FUNCTION public.fn_trg_prova() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$",
    "CREATE TRIGGER trg_prova BEFORE UPDATE OF used_count ON public.coupons FOR EACH ROW EXECUTE FUNCTION public.fn_trg_prova()",
  ]);
  await variante(
    "indice",
    "CREATE INDEX ix_prova ON public.coupons (used_count)",
  );
  await variante(
    "funcao",
    "CREATE FUNCTION public.fn_prova() RETURNS bigint LANGUAGE plpgsql AS $f$ BEGIN RETURN (SELECT max(used_count) FROM public.coupons); END $f$",
  );
  await variante("funcaoFora", [
    "CREATE SCHEMA priv_cdp",
    "CREATE FUNCTION priv_cdp.f() RETURNS bigint LANGUAGE plpgsql AS $f$ BEGIN RETURN (SELECT max(used_count) FROM public.coupons); END $f$",
  ]);
  await variante(
    "forma",
    "ALTER TABLE public.coupons ALTER COLUMN used_count TYPE bigint",
  );
  await variante("usage", "ALTER TABLE public.coupons DROP COLUMN usage_count");
  await variante(
    "usageTipo",
    "ALTER TABLE public.coupons ALTER COLUMN usage_count TYPE bigint",
  );
  await variante(
    "usageDefault",
    "ALTER TABLE public.coupons ALTER COLUMN usage_count DROP DEFAULT",
  );
  await variante(
    "usageNotNull",
    "ALTER TABLE public.coupons ALTER COLUMN usage_count SET NOT NULL",
  );
  await variante(
    "acl",
    "GRANT SELECT (used_count) ON public.coupons TO authenticated",
  );
  await variante(
    "comentario",
    `COMMENT ON COLUMN public.coupons.used_count IS 'contador antigo'`,
  );
  await variante(
    "cego",
    `UPDATE public.coupons SET used_count = 3 WHERE code = 'CP1'`,
  );
  const casos14b = [
    ["valor 3 em uma linha", nb.valor, [LB.linhas]],
    ["NULL em uma linha (NULL nao vale 0)", nb.nulo, [LB.linhas]],
    [
      "coluna GERADA que cita used_count (o pg_attrdef de OUTRA coluna conta)",
      nb.gerada,
      [LB.dep],
    ],
    ["visao que cita a coluna", nb.visao, [LB.dep, LB.vis]],
    ["politica que cita a coluna", nb.politica, [LB.dep, LB.pol]],
    ["gatilho com UPDATE OF used_count", nb.gatilho, [LB.dep, LB.gat]],
    ["indice sobre a coluna", nb.indice, [LB.dep]],
    ["funcao que cita used_count no corpo", nb.funcao, [LB.fn]],
    [
      "funcao FORA de public (schema interno) que cita used_count",
      nb.funcaoFora,
      [LB.fn],
    ],
    ["forma diferente do baseline (bigint)", nb.forma, [LB.forma]],
    ["usage_count ausente", nb.usage, [LB.usage]],
    ["usage_count bigint", nb.usageTipo, [LB.usage]],
    ["usage_count sem default", nb.usageDefault, [LB.usage]],
    ["usage_count NOT NULL", nb.usageNotNull, [LB.usage]],
    [
      "permissao propria por coluna (o DROP a apagaria e o rollback nao a recria)",
      nb.acl,
      [LB.acl],
    ],
    ["comentario da coluna (idem)", nb.comentario, [LB.cmt]],
  ];
  for (const [rotulo, db, esperadas] of casos14b)
    await negativo(B, `14b ${rotulo}`, db, esperadas);
  assert.equal(linha(await rodar(nb.funcao, B), LB.fn).vivo, "public.fn_prova");
  assert.equal(linha(await rodar(nb.funcaoFora, B), LB.fn).vivo, "priv_cdp.f");
  // o papel que SOFRE a RLS nao ve o cupom com valor 3: a contagem dele diz "0" e e' mentira
  {
    const rows = await rodar(nb.cego, B, { papel: P.cego });
    await exigirReprovadas(B, "14b papel cego (RLS)", rows, [LB.rls]);
    assert.equal(
      linha(rows, LB.linhas).vivo,
      "0",
      "o papel cego conta 0 linhas (a RLS esconde o 3)",
    );
    assert.equal(linha(rows, LB.linhas).ok, true);
    // o mesmo banco, medido por quem atravessa a RLS, enxerga o 3
    await exigirReprovadas(
      B,
      "14b papel que atravessa a RLS",
      await rodar(nb.cego, B),
      [LB.linhas],
    );
  }
  // a coluna JA apagada: as linhas dizem AUSENTE, nunca "todas as linhas"
  {
    const rows = await rodar(aplicado, B);
    await exigirReprovadas(B, "14b com a coluna ja apagada", rows, [
      LB.presente,
      LB.forma,
      LB.acl,
      LB.cmt,
      LB.linhas,
      LB.dep,
    ]);
    for (const item of [
      LB.presente,
      LB.forma,
      LB.acl,
      LB.cmt,
      LB.linhas,
      LB.dep,
    ])
      assert.equal(linha(rows, item).vivo, "AUSENTE", item);
  }
  ok(
    "14b NEGATIVA, UMA linha certa por defeito: valor 3 e NULL (linhas), coluna GERADA e indice (dependentes), visao/politica/gatilho (dependentes + a linha do texto), funcao em public ou em OUTRO schema (so a das funcoes), forma bigint, usage_count ausente ou em outra forma (bigint, sem default, NOT NULL), permissao propria por coluna e comentario da coluna (o DROP os apaga e o rollback nao os recria); o papel que sofre a RLS reprova a linha da RLS (e o que atravessa a RLS ve o 3); coluna ja apagada diz AUSENTE em cada linha, nunca 'todas as linhas'",
  );

  // ----------------------------------------------------------- 14a POSITIVOS
  {
    await exigirPositiva(A, "14a em aplicado", cheioAntes);
    await exigirPositiva(A, "14a em crlf", await rodar(crlf, A));
    await exigirPositiva(
      A,
      "14a papel minimo",
      await rodar(aplicado, A, { papel: P.minimo }),
    );
    await exigirPositiva(
      A,
      "14a search_path vazio",
      await rodar(aplicado, A, { antes: ["SET search_path = ''"] }),
    );
    // IGUAL ao banco da arvore inteira (a mesma resposta linha a linha)
    const cheio = await rodar(aplicado, A);
    assert.deepEqual(cheio, cheioAntes);
    ok(
      "14a POSITIVA depois do apply real (LF e CRLF), com o papel minimo e com search_path vazio",
    );
  }

  // ----------------------------------------------------------- 14a NEGATIVOS
  const na = {};
  const varianteA = async (rotulo, ddl, de = aplicado) => {
    const db = await clonar(rotulo, de);
    await usar(db, async (c) => {
      for (const sql of [].concat(ddl)) await c.query(sql);
    });
    na[rotulo] = db;
    return db;
  };
  await varianteA(
    "usageTipo",
    "ALTER TABLE public.coupons ALTER COLUMN usage_count TYPE bigint",
  );
  await varianteA(
    "usageDefault",
    "ALTER TABLE public.coupons ALTER COLUMN usage_count DROP DEFAULT",
  );
  await varianteA(
    "usageAusente",
    "ALTER TABLE public.coupons DROP COLUMN usage_count",
  );
  await varianteA(
    "usageNotNull",
    "ALTER TABLE public.coupons ALTER COLUMN usage_count SET NOT NULL",
  );
  await varianteA(
    "semTabela",
    "ALTER TABLE public.coupons RENAME TO coupons_x",
  );
  // a 14a NAO trava corpo de funcao: uma funcao de cupom alterada nao a reprova
  const valByte = await clonar("valByte", aplicado);
  await reescreverCorpo(valByte, SIG_VAL, (c) => `${c} `);
  const volta = await clonar("volta", aplicado);
  await usar(volta, (c) =>
    c.query(fs.readFileSync(path.join(MIGRATIONS, ARQ_RB), "utf8")),
  );
  const casos14a = [
    ["coluna ainda presente (loja ANTES do apply)", pre, [LA.coluna]],
    ["coluna de volta depois do rollback", volta, [LA.coluna]],
    ["usage_count com outro tipo", na.usageTipo, [LA.usage]],
    ["usage_count sem default", na.usageDefault, [LA.usage]],
    ["usage_count ausente", na.usageAusente, [LA.usage]],
    ["usage_count NOT NULL", na.usageNotNull, [LA.usage]],
    ["tabela coupons ausente", na.semTabela, [LA.tabela, LA.usage]],
  ];
  for (const [rotulo, db, esperadas] of casos14a)
    await negativo(A, `14a ${rotulo}`, db, esperadas);
  await exigirPositiva(
    A,
    "14a com o corpo de validate_coupon_secure_v2 alterado (a 14a nao o trava)",
    await rodar(valByte, A),
  );
  ok(
    "14a NEGATIVA, UMA linha certa por defeito: coluna ainda presente (antes do apply e depois do rollback), usage_count com outro tipo/sem default/NOT NULL/ausente, tabela ausente; e um corpo de funcao de cupom alterado NAO a reprova (quem o trava sao a 10a e a 12a)",
  );

  // ----------------------------------------------------------- MUTANTES
  console.log(
    "\n  --- MUTANTES do texto das consultas (cada um tem de deixar um caso PASSAR) ---",
  );
  // 14b: cada linha ignorada
  await mutanteDaLinha(
    "14b sem a linha 'coluna presente'",
    B,
    LB.presente,
    aplicado,
    [LB.presente, LB.forma, LB.acl, LB.cmt, LB.linhas, LB.dep],
  );
  await mutanteDaLinha("14b sem a linha 'forma'", B, LB.forma, nb.forma, [
    LB.forma,
  ]);
  await mutanteDaLinha(
    "14b sem a linha 'usage_count' (ausente)",
    B,
    LB.usage,
    nb.usage,
    [LB.usage],
  );
  await mutanteDaLinha(
    "14b sem a linha 'usage_count' (bigint)",
    B,
    LB.usage,
    nb.usageTipo,
    [LB.usage],
  );
  await mutanteDaLinha(
    "14b sem a linha 'usage_count' (NOT NULL)",
    B,
    LB.usage,
    nb.usageNotNull,
    [LB.usage],
  );
  await mutanteDaLinha(
    "14b sem a linha da permissao por coluna",
    B,
    LB.acl,
    nb.acl,
    [LB.acl],
  );
  await mutanteDaLinha(
    "14b sem a linha do comentario",
    B,
    LB.cmt,
    nb.comentario,
    [LB.cmt],
  );
  await mutanteDaLinha("14b sem a linha da RLS", B, LB.rls, nb.cego, [LB.rls], {
    papel: P.cego,
  });
  await mutanteDaLinha(
    "14b sem a linha das linhas diferentes de 0",
    B,
    LB.linhas,
    nb.valor,
    [LB.linhas],
  );
  await mutanteDaLinha(
    "14b sem a linha dos dependentes",
    B,
    LB.dep,
    nb.gerada,
    [LB.dep],
  );
  await mutanteDaLinha("14b sem a linha das funcoes", B, LB.fn, nb.funcao, [
    LB.fn,
  ]);
  await mutanteTemQueSerPego(
    "14b varre so public (a funcao de outro schema passa)",
    B,
    [[FILTRO_FN_14B, `   WHERE s.nspname = 'public'\n     AND strpos(`]],
    nb.funcaoFora,
    [LB.fn],
  );
  await mutanteDaLinha(
    "14b sem a linha das politicas",
    B,
    LB.pol,
    nb.politica,
    [LB.dep, LB.pol],
  );
  await mutanteDaLinha("14b sem a linha dos gatilhos", B, LB.gat, nb.gatilho, [
    LB.dep,
    LB.gat,
  ]);
  await mutanteDaLinha("14b sem a linha das visoes", B, LB.vis, nb.visao, [
    LB.dep,
    LB.vis,
  ]);
  // 14b: as clausulas
  await mutanteTemQueSerPego(
    "14b volta a excluir TODO pg_attrdef (esconde a coluna gerada)",
    B,
    [[EXCLUSAO_14B, "     AND d.classid <> 'pg_attrdef'::regclass"]],
    nb.gerada,
    [LB.dep],
  );
  await mutantePositivoTemQueSerPego(
    "14b nao exclui o default da PROPRIA coluna (o positivo reprovaria)",
    B,
    [[EXCLUSAO_14B, "     AND TRUE"]],
    pre,
  );
  await mutanteComChecagem(
    "14b sem o guarda AUSENTE da contagem (to_jsonb sem a chave conta TODA linha)",
    B,
    [
      [
        GUARDA_AUSENTE_LINHAS,
        `(SELECT count(*)::text FROM public.coupons c
                     WHERE (to_jsonb(c) -> 'used_count') IS DISTINCT FROM '0'::jsonb)`,
      ],
    ],
    aplicado,
    (rows) =>
      assert.equal(
        linha(rows, LB.linhas).vivo,
        "AUSENTE",
        "a contagem sem o guarda diz o numero de cupons, nao AUSENTE",
      ),
  );
  await mutanteTemQueSerPego(
    "14b conta NULL como 0 (COALESCE)",
    B,
    [
      [
        `WHERE (to_jsonb(c) -> 'used_count') IS DISTINCT FROM '0'::jsonb) END`,
        `WHERE (to_jsonb(c) -> 'used_count') IS DISTINCT FROM '0'::jsonb AND (to_jsonb(c) -> 'used_count') <> 'null'::jsonb) END`,
      ],
    ],
    nb.nulo,
    [LB.linhas],
  );
  // 14a: cada linha ignorada
  await mutanteDaLinha(
    "14a sem a linha da tabela",
    A,
    LA.tabela,
    na.semTabela,
    [LA.tabela, LA.usage],
  );
  await mutanteDaLinha("14a sem a linha da coluna", A, LA.coluna, pre, [
    LA.coluna,
  ]);
  await mutanteDaLinha(
    "14a sem a linha do usage_count (bigint)",
    A,
    LA.usage,
    na.usageTipo,
    [LA.usage],
  );
  await mutanteDaLinha(
    "14a sem a linha do usage_count (NOT NULL)",
    A,
    LA.usage,
    na.usageNotNull,
    [LA.usage],
  );
  ok(
    "MUTANTES do texto das consultas: cada uma das linhas da 14b e da 14a ignorada (menos a de controle, sem negativo local), a exclusao do default da PROPRIA coluna (voltar a excluir todo pg_attrdef esconde a coluna gerada; nao excluir nada reprova o positivo), o guarda AUSENTE da contagem e NULL como 0 deixam um caso PASSAR e a prova ficaria VERMELHA",
  );

  // ----------------------------------------------------------- ROL FECHADO
  {
    const rows = await rodar(aplicado, A);
    const parcial = rows.filter((r) => r.ok === true);
    assert.ok(parcial.length === rows.length); // 14a positiva: tudo ok, so para montar o parcial abaixo
    const rowsPre = await rodar(pre, A);
    const soOk = rowsPre.filter((r) => r.ok === true);
    assert.ok(soOk.length > 0 && soOk.length < rowsPre.length);
    const v = veredito(A, soOk);
    assert.ok(v.endsWith("rol=invalido"), v);
    assert.equal(
      (await portaoComLog(A, v)).estado,
      "SEM_EVIDENCIA",
      "resposta PARCIAL com tudo ok=true nunca e positiva",
    );
    const dup = [...rows, rows[0]];
    assert.ok(veredito(A, dup).endsWith("rol=invalido"));
    assert.equal(
      (await portaoComLog(A, veredito(A, dup))).estado,
      "SEM_EVIDENCIA",
    );
    const rowsB = await rodar(pre, B);
    assert.ok(veredito(A, rowsB).endsWith("rol=invalido"));
    assert.ok(veredito(B, rows).endsWith("rol=invalido"));
    ok(
      "rol FECHADO: a resposta PARCIAL (so as linhas ok=true), com linha duplicada ou com o rol da OUTRA consulta tem rol=invalido e o portao a trata como SEM_EVIDENCIA, nunca POSITIVA",
    );
  }
  for (const consulta of [A, B]) {
    const quebrado = SQL[consulta].replace(
      "SELECT item, esperado, vivo, COALESCE",
      "SELEC item, esperado, vivo, COALESCE",
    );
    assert.notEqual(quebrado, SQL[consulta]);
    const r = await tentar(aplicado, consulta, { sql: quebrado });
    assert.ok(r.erro && r.erro.code === "42601", String(r.erro));
    assert.equal(r.rows, undefined);
    assert.equal(
      (await portaoComLog(consulta, null, "success")).estado,
      "SEM_EVIDENCIA",
    );
    assert.equal(
      (await portaoComLog(consulta, null, "failure")).estado,
      "SEM_EVIDENCIA",
    );
  }
  ok(
    "erro de SQL (42601) na 14a e na 14b: falha ALTA, nenhuma linha, e o portao fica SEM_EVIDENCIA mesmo com o run verde -- erro nunca vira positivo",
  );

  // ----------------------------------------------------------- PONTA A PONTA
  {
    const api = await subirApi();
    const env = (consulta) => ({
      CONFERIR_BANCO_API_BASE: api.base,
      PROJETO: "savy",
      CONSULTA: consulta,
      SUPABASE_ACCESS_TOKEN_SAVY: "tk-teste",
      GITHUB_SHA: SHA40,
    });
    const executar = async (dbAlvo, consulta, papel = P.ro) => {
      api.estado.db = dbAlvo;
      api.estado.papel = papel;
      return rodarScript(env(consulta));
    };
    let reloginho = Date.parse("2026-10-09T13:00:00Z");
    const evidencia = async (consulta, saida, conclusao = "success") => {
      reloginho += 60000;
      return PORTAO.evidenciaDaProva({
        consulta,
        projeto: "savy",
        ref: REF_SAVY,
        sha: SHA40,
        topo: SHA40,
        validadeHoras: 6,
        agora: reloginho + 1000,
        deps: {
          listarRuns: async (wf) =>
            wf === "conferir-banco-da-loja.yml"
              ? [
                  {
                    databaseId: 1,
                    displayTitle: `conferir ${consulta} em savy`,
                    headSha: SHA40,
                    createdAt: new Date(reloginho).toISOString(),
                    conclusion: conclusao,
                    status: "completed",
                  },
                ]
              : [],
          logDoRun: async () => saida,
          arvoreIgual: async () => true,
        },
      });
    };
    const canais = PORTAO.lerCanais();
    const lote = canais.provasDeObjetos.find((p) => p.consulta === A);
    assert.ok(lote, "o canais-de-backend.json real nao declara o lote da 14a");
    assert.deepEqual(lote.versoes, [V]);
    assert.equal(lote.ausenciaConfirmadaPor, B);
    for (const campo of [
      "backfillLedger",
      "nuncaAplicar",
      "soNosRefs",
      "conferenciasAntesDoApply",
    ])
      assert.equal(
        lote[campo],
        undefined,
        `o lote nao devia declarar ${campo}`,
      );
    const decidir = async (dbAlvo, { faltam, exigeProva }) => {
      const sa = await executar(dbAlvo, A);
      assert.equal(sa.codigo, 0, sa.saida);
      const sb = await executar(dbAlvo, B);
      assert.equal(sb.codigo, 0, sb.saida);
      const prova = await evidencia(A, sa.saida);
      const diag = new Map([[B, await evidencia(B, sb.saida)]]);
      return {
        prova,
        diag: diag.get(B),
        decisao: PORTAO.decidirLote({
          lote: { ...lote, versoes: [V] },
          faltam,
          exigeProva,
          prova,
          diagnostico: diag,
        }),
      };
    };
    try {
      // E1: o veredito real do processo filho
      const e1 = await executar(aplicado, A);
      assert.equal(e1.codigo, 0, e1.saida);
      assert.deepEqual(PORTAO.lerVeredicto(e1.saida, A), {
        ref: REF_SAVY,
        sha: SHA40,
        linhas: 4,
        okFalse: 0,
        naoBooleano: 0,
        rol: "ok",
      });
      const e1b = await executar(pre, B);
      assert.deepEqual(PORTAO.lerVeredicto(e1b.saida, B), {
        ref: REF_SAVY,
        sha: SHA40,
        linhas: 13,
        okFalse: 0,
        naoBooleano: 0,
        rol: "ok",
      });
      // E2: banco inexistente -> HTTP 400, saida 1, NENHUM veredito, SEM_EVIDENCIA
      const e2 = await executar("cdp_banco_que_nao_existe", A);
      assert.equal(e2.codigo, 1, e2.saida);
      assert.ok(!e2.saida.includes("VEREDITO-CONSULTA"), e2.saida);
      assert.equal((await evidencia(A, e2.saida)).estado, "SEM_EVIDENCIA");

      // L1: loja ANTES do apply (ledger sem a versao): 14a NEGATIVA + 14b POSITIVA -> APLICAR
      const l1 = await decidir(pre, { faltam: [V], exigeProva: true });
      assert.equal(l1.prova.estado, "NEGATIVA");
      assert.equal(l1.diag.estado, "POSITIVA");
      assert.equal(l1.decisao.acao, "APLICAR", JSON.stringify(l1.decisao));
      assert.deepEqual(l1.decisao.versoes, [V]);
      // L2: loja DEPOIS do apply, ledger com a versao: 14a POSITIVA -> NADA
      const l2 = await decidir(aplicado, { faltam: [], exigeProva: true });
      assert.equal(l2.prova.estado, "POSITIVA");
      assert.equal(l2.decisao.acao, "NADA", JSON.stringify(l2.decisao));
      // L3: coluna ja apagada mas o ledger SEM a versao e sem backfillLedger -> PARAR, nenhum apply
      const l3 = await decidir(aplicado, { faltam: [V], exigeProva: true });
      assert.equal(l3.prova.estado, "POSITIVA");
      assert.equal(l3.decisao.acao, "PARAR", JSON.stringify(l3.decisao));
      assert.match(l3.decisao.motivo, /não declara backfillLedger/);
      // L4: loja ANTES do apply mas com um valor 3 (14b NEGATIVA) -> PARAR: o dono decide, nenhum apply
      const l4 = await decidir(nb.valor, { faltam: [V], exigeProva: true });
      assert.equal(l4.prova.estado, "NEGATIVA");
      assert.equal(l4.diag.estado, "NEGATIVA");
      assert.equal(l4.decisao.acao, "PARAR", JSON.stringify(l4.decisao));
      assert.ok(!l4.decisao.versoes, "PARAR nao carrega versoes a aplicar");
      // L5: coluna GERADA que cita used_count (o defeito do achado): 14b NEGATIVA -> PARAR
      const l5 = await decidir(nb.gerada, { faltam: [V], exigeProva: true });
      assert.equal(l5.diag.estado, "NEGATIVA");
      assert.equal(l5.decisao.acao, "PARAR", JSON.stringify(l5.decisao));
      // L6: ledger com a versao mas a coluna de volta (rollback aplicado a mao): 14a NEGATIVA -> PARAR
      const l6 = await decidir(volta, { faltam: [], exigeProva: true });
      assert.equal(l6.prova.estado, "NEGATIVA");
      assert.equal(l6.decisao.acao, "PARAR", JSON.stringify(l6.decisao));
      // L7: o papel que sofre a RLS mede a 14b: reprova (nunca autoriza o apply)
      api.estado.db = nb.cego;
      api.estado.papel = P.cego;
      const sb7 = await rodarScript(env(B));
      assert.equal(sb7.codigo, 0, sb7.saida);
      const diag7 = await evidencia(B, sb7.saida);
      assert.equal(
        diag7.estado,
        "NEGATIVA",
        "o papel cego nunca autoriza o apply",
      );
      ok(
        "ponta a ponta (conferir-banco.cjs de verdade, HTTP local, papel de leitura, canais-de-backend.json REAL): ANTES do apply 14a NEGATIVA + 14b POSITIVA -> APLICAR [20261207000000]; depois do apply 14a POSITIVA -> NADA; coluna apagada sem a versao no ledger -> PARAR (sem backfill); 14b NEGATIVA (valor 3 ou coluna gerada) -> PARAR sem versoes; coluna de volta com o ledger completo -> PARAR; papel que sofre a RLS nunca autoriza o apply; banco inexistente -> saida 1, sem veredito, SEM_EVIDENCIA",
      );
    } finally {
      await api.parar();
    }
  }

  console.log(`\n[contador-duplicado-portao-viva] ${resultados} provas ok`);
}

main()
  .catch((erro) => {
    console.error("\n[FALHOU]", erro?.stack ? erro.stack : erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const n of clones) {
      await usar("template1", (a) =>
        a.query(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`),
      ).catch(() => {});
    }
    for (const papel of Object.values(P)) {
      await usar("template1", (a) =>
        a.query(`DROP ROLE IF EXISTS ${papel}`),
      ).catch(() => {});
    }
  });

// `falhar` e `mutar` ficam importados/definidos para o caso de a trava de efemero recusar antes.
void falhar;
void mutar;
