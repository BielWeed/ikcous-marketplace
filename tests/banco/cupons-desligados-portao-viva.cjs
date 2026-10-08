"use strict";

/**
 * Prova VIVA das duas consultas do PORTÃO DA RELEASE para a migration
 * 20261203000000 (cupons desligados não dão desconto, issue #645), num Postgres
 * EFÊMERO local — nada de rede, nada de loja:
 *   10a-conferir-cupons-desligados-aplicado.sql        (DEPOIS do apply: 21 linhas)
 *   10b-antes-cupons-desligados-gatilho-e-corpo.sql    (ANTES do apply: 6 linhas)
 * Elas são a "prova de objetos" do lote 20261203000000 em
 * scripts/frota/canais-de-backend.json: sem elas o portão
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration
 * nova. Esta prova diz que cada consulta DECIDE certo — não que a CAF ou a Savy
 * estão no estado A ou B (isso só o run da consulta contra o ref de cada loja diz).
 *
 * COMO RODA: cada defeito num banco CLONADO (`CREATE DATABASE … TEMPLATE`, do banco
 * já migrado que o rodar-isolado.cjs entrega) que some no fim; a consulta sempre
 * como um papel de LEITURA não superusuário (clone do supabase_read_only_user:
 * LOGIN BYPASSRLS + pg_read_all_data, read-only por padrão). Cada veredito é levado
 * até o PORTÃO de verdade (`evidenciaDaProva` e `decidirLote`, de
 * scripts/frota/publicar-release.mjs): "positiva" aqui quer dizer POSITIVA para o
 * portão, com `rol=ok`; "reprova" quer dizer NEGATIVA (nunca POSITIVA).
 *
 * BASES (montadas aqui, pelos mesmos scripts do rpc-ci.yml):
 *   cheio     a árvore inteira de migrations (com a 20261203000000);
 *   pre       a árvore SEM a 20261203000000 (o estado de uma loja antes do apply);
 *   aplicado  `pre` + o ARQUIVO da migration aplicado de verdade (LF);
 *   crlf      `pre` + o arquivo da migration com fim de linha CRLF (checkout Windows);
 *   baseline-crlf  `pre` com o corpo da validate_coupon_secure_v2 em CRLF.
 *
 * CASOS (cada um com a LINHA exata que reprova; o veredito real, com rol=ok e o
 * ok_false esperado, é conferido em TODO caso):
 *  POSITIVOS  10b em `pre` (também com o baseline em CRLF); 10a em `cheio`, em
 *             `aplicado` (IGUAL linha a linha ao `cheio`) e em `crlf`; 10a e 10b
 *             com o papel mínimo e com search_path trocado e objetos-isca de mesmo
 *             nome em outro schema; a resposta tem sempre o rol fechado e nenhum
 *             dado de pedido, cupom ou cliente.
 *  10a        N1 gatilho ausente; N2 desabilitado (D), ENABLE ALWAYS (A), REPLICA
 *             (R); N3 sem WHEN, WHEN IS NULL, WHEN com condição a mais; N4 BEFORE
 *             INSERT OR UPDATE, AFTER INSERT, aponta para outra função; N5 corpo da
 *             validate com 1 byte a mais, com o corpo do baseline, sobrecarga extra,
 *             SECURITY INVOKER, sem search_path, EXECUTE para PUBLIC, authenticated
 *             revogado; N6 corpo do gatilho com 1 byte a mais, sem search_path,
 *             SECURITY INVOKER, EXECUTE para PUBLIC (3 linhas), anon, authenticated;
 *             N7 índice único ausente, por (user_id, chave), sem o parcial, não único.
 *  10b        B1 gatilho presente mas desabilitado; B2 corpo com 1 byte a mais que o
 *             baseline; B3 sobrecarga extra; B4 corpo NOVO sem o gatilho (meia
 *             migration); B5/B6 coluna ausente; B7 validate ausente. Na base
 *             `aplicado` a 10b reprova nas duas linhas certas.
 *  MUTANTES   cada cláusula da consulta, desligada no texto do .sql, deixa um
 *             negativo PASSAR e esta prova ficaria VERMELHA (hash da validate, hash
 *             do gatilho, WHEN, habilitado, evento, search_path, ACL de anon,
 *             predicado do índice; na 10b a presença do gatilho e o baseline).
 *  FECHADO    resposta PARCIAL (só as linhas ok, as reprovadas omitidas) e linha
 *             duplicada têm rol=invalido: o portão NUNCA as trata como positivas.
 *  ERRO       SQL truncado (42601) e banco inexistente: falha ALTA, nenhuma linha
 *             VEREDITO-CONSULTA, o portão fica SEM_EVIDENCIA mesmo com o run verde.
 *  PONTA A PONTA  conferir-banco.cjs de verdade (processo filho, HTTP local) e o
 *             LOTE do canais-de-backend.json REAL no `decidirLote`: ledger sem a
 *             versão + 10a NEGATIVA + 10b POSITIVA → APLICAR; 10a POSITIVA → PARAR
 *             (sem backfillLedger); ledger com a versão + 10a POSITIVA → NADA; as
 *             duas NEGATIVAS → PARAR.
 *
 * Toda mutação (de objeto, papel ou tabela) leva uma GUARDA que dá RAISE se não
 * aplicou: sem ela, um mutante que não aplica nada vira falso verde. Papéis
 * temporários com nome único, limpos no `finally`.
 *
 * LIMITE DECLARADO: o Postgres é o 17 LOCAL; o papel de leitura real da loja
 * (supabase_read_only_user), o Postgres 15/17 da Supabase e a ACL real das lojas
 * não foram medidos aqui.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/cupons-desligados-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vêm do próprio repositório (a pasta de consultas, as migrations e o
 * publicar-release.mjs), nunca de entrada de rede; as chaves de objeto vêm de
 * constantes e mapas fechados deste arquivo (nomes das consultas, das linhas e dos
 * bancos de teste), nunca de entrada externa. */

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
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do próprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);

const A = "10a-conferir-cupons-desligados-aplicado";
const B = "10b-antes-cupons-desligados-gatilho-e-corpo";
const VERSAO = "20261203000000";
const ARQUIVO = "20261203000000_cupons_desligados_nao_dao_desconto.sql";
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const SHA40 = "d".repeat(40);
const SQL = {
  [A]: fs.readFileSync(path.join(CONSULTAS, `${A}.sql`), "utf8"),
  [B]: fs.readFileSync(path.join(CONSULTAS, `${B}.sql`), "utf8"),
};
const ROL = { [A]: CONF.ROL_DA_10A, [B]: CONF.ROL_DA_10B };
const N_LINHAS = { [A]: 21, [B]: 6 };

const SIG_V = "public.validate_coupon_secure_v2(text,numeric)";
const SIG_G = "public.pedido_com_cupom_exige_a_chave_ligada()";
const GATILHO = "tr_pedido_com_cupom_exige_a_chave_ligada";
const INDICE = "marketplace_orders_chave_da_compra_unica";
const HASH = {
  vNovoLF: "489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3",
  vNovoCRLF: "4b096e67be79665d70e86ff5e94953ecf5842cd64abca882abac0f6cbe328279",
  vBaseLF: "5fefbbe6648d44e9f6837b2a6f24d8a5223060f55b8a67fa68c223a15ab742d7",
  vBaseCRLF: "b325866f6648a0f97d13d894c823a89e1ff2a6682d49db3d25816cef358eaddc",
  gLF: "35cd7a320dd1fe3673a4f0a0e3cd43dfb5bd608ff5f1636e5f94e5709b4a86e2",
  gCRLF: "9060af97c05c2e80e0354f8ae8244ca3716d3ab225b2f3dbf3198d4cffe959fe",
};
const HASH_DE = (sig) =>
  `(SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = to_regprocedure('${sig}'))`;

// Os nomes das linhas (o rol fechado do código tem os mesmos).
const T = `gatilho ${GATILHO}`;
const L = {
  controle: "controle: funcoes de public visiveis a este papel",
  gExiste: `${T}: existe em marketplace_orders`,
  gEvento: `${T}: momento e evento`,
  gHab: `${T}: habilitado`,
  gWhen: `${T}: condicao WHEN`,
  gFn: `${T}: funcao executada`,
  fDef: "funcao do gatilho: SECURITY DEFINER",
  fSp: "funcao do gatilho: search_path",
  fLang: "funcao do gatilho: linguagem e retorno",
  fHash: "funcao do gatilho: corpo (sha256)",
  fPub: "funcao do gatilho: EXECUTE para PUBLIC",
  fAnon: "funcao do gatilho: EXECUTE para anon",
  fAuth: "funcao do gatilho: EXECUTE para authenticated",
  vSobre: "validate_coupon_secure_v2: sobrecargas",
  vHash: "validate_coupon_secure_v2: corpo (sha256)",
  vDef: "validate_coupon_secure_v2: SECURITY DEFINER",
  vSp: "validate_coupon_secure_v2: search_path",
  vPub: "validate_coupon_secure_v2: EXECUTE para PUBLIC",
  vAuth: "validate_coupon_secure_v2: EXECUTE para authenticated",
  iExiste: `indice ${INDICE}: existe`,
  iDef: `indice ${INDICE}: definicao`,
};
const LB = {
  controle: L.controle,
  bCoupon: "coluna marketplace_orders.coupon_id: existe",
  bEnable: "coluna store_config.enable_coupons: existe",
  bGat: `${T}: ausente em marketplace_orders`,
  bHash: "validate_coupon_secure_v2: corpo e o baseline (sha256)",
  bSobre: "validate_coupon_secure_v2: sobrecargas",
};
const ordena = (l) => [...l].sort();

const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const P = {
  ro: `pv_ro_${SUF}`, // LOGIN BYPASSRLS + pg_read_all_data: imita o supabase_read_only_user
  minimo: `pv_min_${SUF}`, // NOLOGIN, nenhum privilégio além dos de PUBLIC
};

const urlBase = lerDatabaseUrlEfemera();
const MOLDE = new URL(urlBase).pathname.replace(/^\//, "") || "postgres";
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
async function clonar(rotulo, de = MOLDE) {
  const nome = `pv_${SUF}_${clones.length}_${rotulo}`.slice(0, 60);
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      await usar("template1", (a) =>
        a.query(`CREATE DATABASE "${nome}" TEMPLATE "${de}"`),
      );
      break;
    } catch (e) {
      // 55006: o molde ainda está sendo liberado pela conexão que acabou de fechar.
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
    `${path.basename(argv[0])} falhou:
${(r.stdout || "").slice(-600)}
${(r.stderr || "").slice(-600)}`,
  );
}
/** Monta um banco NOVO: provisiona e aplica as migrations que passam no filtro, pelos
 * mesmos scripts do rpc-ci.yml. As migrations vão para um diretório NOVO e EXCLUSIVO
 * desta execução (mkdtemp), removido no fim: nada compartilhado. */
async function montarBase(nome, filtro) {
  await usar("template1", (a) => a.query(`CREATE DATABASE "${nome}"`));
  clones.push(nome);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-"));
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
/** Aplica, num banco já existente, SÓ o arquivo da migration (com o fim de linha pedido). */
function aplicarMigration(db, { crlf = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-ap-"));
  try {
    let texto = fs.readFileSync(path.join(MIGRATIONS, ARQUIVO), "utf8");
    texto = texto.replace(/\r\n/g, "\n");
    if (crlf) texto = texto.replace(/\n/g, "\r\n");
    fs.writeFileSync(path.join(dir, ARQUIVO), texto);
    rodarScriptNode([path.join(__dirname, "aplicar-migrations.cjs"), dir], {
      ...process.env,
      DATABASE_URL: urlDe(db),
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Uma mutação SEGUIDA de uma guarda que dá RAISE se ela não aplicou. `guarda` é uma
 * expressão booleana que tem de ser VERDADEIRA depois. */
async function mutar(db, rotulo, sql, guarda) {
  await usar(db, async (c) => {
    await c.query(sql);
    await c.query(
      `DO $g$ BEGIN IF NOT COALESCE((${guarda}), false) THEN RAISE EXCEPTION 'a mutacao nao aplicou: ${rotulo.replace(/'/g, "''")}'; END IF; END $g$`,
    );
  });
}
/** Reescreve o CORPO de uma função mantendo cabeçalho, atributos e ACL (CREATE OR
 * REPLACE com o texto de pg_get_functiondef). */
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
const corpoDe = (db, sig) =>
  usar(
    db,
    async (c) =>
      (
        await c.query(
          "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
          [sig],
        )
      ).rows[0].prosrc,
  );

// ---------------------------------------------------------------------------
// Rodar a consulta
// ---------------------------------------------------------------------------
/** Roda a consulta como `papel`, em transação somente leitura. Devolve as linhas ou
 * LANÇA o erro do banco. */
async function rodar(db, consulta, { papel = P.ro, sql, antes = [] } = {}) {
  const texto = sql ?? SQL[consulta];
  assert.equal(CONF.contarStatements(texto), 1, "exatamente 1 statement");
  return usar(db, async (c) => {
    for (const a of antes) await c.query(a); // com o usuário da conexão, ANTES do SET ROLE
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
// O PORTÃO
// ---------------------------------------------------------------------------
let PORTAO; // módulo ESM do portão (carregado em main)
let relogio = Date.parse("2026-10-08T12:00:00Z");
/** O estado que o PORTÃO daria para `linhaDeVeredito` (ou para a falta dela). */
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

/** Formato que vale para TODA resposta: o rol fechado EXATO do código, `ok` sempre
 * booleano, `ok=false` primeiro, nenhuma coluna de linha de pedido, cupom ou cliente. */
function exigirFormato(consulta, rotulo, rows) {
  assert.equal(rows.length, N_LINHAS[consulta], `${rotulo}: nº de linhas`);
  assert.equal(
    CONF.estruturaDoRolFechado(rows, ROL[consulta]),
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
/** POSITIVO: nenhuma linha reprova, o veredito sai com rol=ok e o portão dá POSITIVA. */
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
/** NEGATIVO: reprova EXATAMENTE as linhas esperadas, e o portão NUNCA dá POSITIVA. */
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
/** Roda a consulta REAL num banco e exige que reprove exatamente `esperadas`. */
async function negativo(consulta, rotulo, db, esperadas, opcoes = {}) {
  const rows = await rodar(db, consulta, opcoes);
  await exigirReprovadas(consulta, rotulo, rows, esperadas);
  return rows;
}
/** Um MUTANTE do texto do .sql tem de ser PEGO: com ele, o negativo `db` deixa de
 * reprovar o que devia e `exigirReprovadas` LANÇA — a prova ficaria vermelha. */
async function mutanteTemQueSerPego(rotulo, consulta, trocas, db, esperadas) {
  let sql = SQL[consulta];
  for (const [de, para] of trocas) {
    assert.ok(
      sql.includes(de),
      `${rotulo}: o trecho a mutar não existe: ${de}`,
    );
    const novo = sql.replace(de, () => para);
    assert.notEqual(novo, sql);
    sql = novo;
  }
  const rows = await rodar(db, consulta, { sql });
  let pego = false;
  try {
    await exigirReprovadas(consulta, `mutante ${rotulo}`, rows, esperadas);
  } catch (e) {
    pego = true;
    assert.ok(e instanceof assert.AssertionError, String(e));
  }
  assert.ok(
    pego,
    `${rotulo}: o MUTANTE passou despercebido (o negativo continuou reprovando as linhas esperadas)`,
  );
  // E o mutante de fato deixou o negativo MAIS verde do que a consulta real.
  const real = await rodar(db, consulta);
  assert.ok(
    reprovadas(rows).length < reprovadas(real).length,
    `${rotulo}: o mutante não afrouxou nada (${reprovadas(rows).length} x ${reprovadas(real).length})`,
  );
}

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
      `o portão tem de tratar ${c} como consulta de ROL FECHADO (só vale com rol=ok)`,
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
  assert.deepEqual(
    ordena(CONF.ROL_DA_10A),
    ordena(Object.values(L)),
    "o rol da 10a do código é o conjunto de itens que esta prova conhece",
  );
  assert.deepEqual(
    ordena(CONF.ROL_DA_10B),
    ordena(Object.values(LB)),
    "o rol da 10b do código é o conjunto de itens que esta prova conhece",
  );

  // Os papéis são do CLUSTER; a prova os cria (nomes únicos) e os remove no finally.
  await usar("template1", async (a) => {
    await a.query(`CREATE ROLE ${P.ro} LOGIN BYPASSRLS`);
    await a.query(`ALTER ROLE ${P.ro} SET default_transaction_read_only = on`);
    await a.query(`CREATE ROLE ${P.minimo} NOLOGIN`);
    await a.query(`GRANT pg_read_all_data TO ${P.ro}`);
  });

  // ----------------------------------------------------------- precondição
  {
    const sonda = await usar(MOLDE, async (c) => ({
      gatilho: (
        await c.query(
          "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = $1",
          [GATILHO],
        )
      ).rows[0].n,
      eu: (
        await c.query(
          "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
        )
      ).rows[0].rolsuper,
      pedidos: (
        await c.query(
          "SELECT count(*)::int AS n FROM public.marketplace_orders",
        )
      ).rows[0].n,
    }));
    assert.equal(
      sonda.gatilho,
      1,
      "precondição: a árvore inteira tem o gatilho",
    );
    assert.equal(
      sonda.eu,
      true,
      "precondição: a conexão da prova é superusuário",
    );
    assert.equal(
      sonda.pedidos,
      0,
      "precondição: o banco migrado começa sem pedido",
    );
    const arquivo = fs.readFileSync(path.join(MIGRATIONS, ARQUIVO), "utf8");
    assert.ok(
      arquivo.includes(`'${HASH.vNovoLF}'`) &&
        arquivo.includes(`'${HASH.vBaseLF}'`),
    );
    ok(
      "precondição: banco migrado com a árvore inteira (gatilho presente), vazio, conexão superusuário",
    );
  }

  // ----------------------------------------------------------- as bases
  const cheio = await clonar("cheio");
  const pre = `pv_${SUF}_pre`.slice(0, 60);
  await montarBase(pre, (f) => f !== ARQUIVO);
  {
    const sonda = await usar(pre, async (c) => ({
      gatilho: (
        await c.query(
          "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = $1",
          [GATILHO],
        )
      ).rows[0].n,
      funcao: (
        await c.query("SELECT to_regprocedure($1) IS NOT NULL AS e", [SIG_G])
      ).rows[0].e,
      hash: (await c.query(`SELECT ${HASH_DE(SIG_V)} AS h`)).rows[0].h,
    }));
    assert.deepEqual(sonda, { gatilho: 0, funcao: false, hash: HASH.vBaseLF });
  }
  const aplicado = await clonar("aplicado", pre);
  aplicarMigration(aplicado);
  const crlf = await clonar("crlf", pre);
  aplicarMigration(crlf, { crlf: true });
  const baselineCrlf = await clonar("basecrlf", pre);
  await reescreverCorpo(baselineCrlf, SIG_V, (c) => c.replace(/\n/g, "\r\n"));
  await mutar(
    baselineCrlf,
    "baseline em CRLF",
    "SELECT 1",
    `${HASH_DE(SIG_V)} = '${HASH.vBaseCRLF}'`,
  );
  ok(
    "bases montadas: cheio (árvore inteira), pre (sem a 20261203000000: sem gatilho, sem a função, corpo do baseline), aplicado (pre + o ARQUIVO aplicado, LF), crlf (idem, arquivo em CRLF) e pre com o baseline da validate em CRLF",
  );

  // ----------------------------------------------------------- POSITIVOS
  const rowsCheio = await rodar(cheio, A);
  await exigirPositiva(A, "10a em cheio", rowsCheio);
  {
    const rowsAplicado = await rodar(aplicado, A);
    await exigirPositiva(A, "10a em aplicado", rowsAplicado);
    assert.deepEqual(
      rowsAplicado,
      rowsCheio,
      "o apply isolado do ARQUIVO sobre a base pré é indistinguível da árvore inteira",
    );
    const rowsCrlf = await rodar(crlf, A);
    await exigirPositiva(A, "10a em crlf", rowsCrlf);
    assert.equal(linha(rowsCrlf, L.vHash).vivo, HASH.vNovoLF);
    assert.equal(linha(rowsCrlf, L.fHash).vivo, HASH.gLF);
    await usar(crlf, async (c) => {
      const h = (
        await c.query(`SELECT ${HASH_DE(SIG_V)} AS v, ${HASH_DE(SIG_G)} AS g`)
      ).rows[0];
      assert.equal(
        h.v,
        HASH.vNovoCRLF,
        "guarda: o corpo da validate ficou em CRLF",
      );
      assert.equal(h.g, HASH.gCRLF, "guarda: o corpo do gatilho ficou em CRLF");
    });
    ok(
      "10a POSITIVA (21 linhas, rol=ok, portão POSITIVA) na árvore inteira, no ARQUIVO aplicado sobre a base pré (resposta IDÊNTICA linha a linha) e no arquivo aplicado em CRLF (os dois corpos gravados em CRLF, hashes CRLF aceitos)",
    );
  }
  {
    const rows = await rodar(pre, B);
    await exigirPositiva(B, "10b em pre", rows);
    assert.equal(linha(rows, LB.bHash).vivo, HASH.vBaseLF);
    const rowsC = await rodar(baselineCrlf, B);
    await exigirPositiva(B, "10b em baseline CRLF", rowsC);
    ok(
      "10b POSITIVA (6 linhas, rol=ok, portão POSITIVA) na base SEM a migration, também com o baseline da validate em CRLF",
    );
  }
  {
    // outro papel e outro search_path: as consultas só leem catálogo e nomeiam tudo
    // com `public.`; objetos-isca de mesmo nome em outro schema não mudam nada.
    const iscas = await clonar("iscas", aplicado);
    await mutar(
      iscas,
      "schema de iscas",
      `CREATE SCHEMA pv_isca;
       CREATE TABLE pv_isca.marketplace_orders (id int, coupon_id int);
       CREATE FUNCTION pv_isca.validate_coupon_secure_v2(p_code text, p_subtotal numeric) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
       CREATE FUNCTION pv_isca.pedido_com_cupom_exige_a_chave_ligada() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
       GRANT USAGE ON SCHEMA pv_isca TO PUBLIC`,
      "to_regclass('pv_isca.marketplace_orders') IS NOT NULL",
    );
    for (const [papel, antes, rotulo] of [
      [P.minimo, [], "papel mínimo (sem BYPASSRLS nem pg_read_all_data)"],
      [
        P.ro,
        ["SET search_path = pv_isca, pg_catalog"],
        "search_path com as iscas à frente",
      ],
      [P.ro, ["SET search_path = pg_catalog"], "search_path só pg_catalog"],
    ]) {
      await exigirPositiva(
        A,
        `10a ${rotulo}`,
        await rodar(iscas, A, { papel, antes }),
      );
    }
    await exigirPositiva(
      B,
      "10b papel mínimo",
      await rodar(pre, B, { papel: P.minimo }),
    );
    // no banco PRÉ com iscas à frente do search_path, a 10b segue positiva
    const preIscas = await clonar("preiscas", pre);
    await mutar(
      preIscas,
      "iscas no pre",
      `CREATE SCHEMA pv_isca;
       CREATE TABLE pv_isca.marketplace_orders (id int, coupon_id int);
       CREATE FUNCTION pv_isca.validate_coupon_secure_v2(p_code text, p_subtotal numeric) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
      "to_regclass('pv_isca.marketplace_orders') IS NOT NULL",
    );
    await exigirPositiva(
      B,
      "10b com iscas",
      await rodar(preIscas, B, {
        antes: ["SET search_path = pv_isca, pg_catalog"],
      }),
    );
    ok(
      "10a e 10b POSITIVAS também com o papel mínimo, com search_path trocado e com objetos-isca de mesmo nome em outro schema (tudo é nomeado com public.)",
    );
  }

  // ----------------------------------------------------------- 10a: NEGATIVOS
  const db = {};
  const novo = async (rotulo, sqlMut, guarda) => {
    const nome = await clonar(rotulo, cheio);
    await mutar(nome, rotulo, sqlMut, guarda);
    return nome;
  };
  const trig = (campo) =>
    `(SELECT ${campo} FROM pg_trigger WHERE tgname = '${GATILHO}' AND tgrelid = 'public.marketplace_orders'::regclass)`;
  const recriar = (
    clausulas,
    fn = "public.pedido_com_cupom_exige_a_chave_ligada()",
  ) =>
    `DROP TRIGGER ${GATILHO} ON public.marketplace_orders;
     CREATE TRIGGER ${GATILHO} ${clausulas} EXECUTE FUNCTION ${fn}`;
  const QUANDO = "WHEN (NEW.coupon_id IS NOT NULL)";
  const FOR_ROW = "ON public.marketplace_orders FOR EACH ROW";

  // N1 gatilho ausente
  db.n1 = await novo(
    "n1",
    `DROP TRIGGER ${GATILHO} ON public.marketplace_orders`,
    `${trig("count(*)")} = 0`,
  );
  await negativo(A, "N1 gatilho ausente", db.n1, [
    L.gExiste,
    L.gEvento,
    L.gHab,
    L.gWhen,
    L.gFn,
  ]);
  {
    const r = await rodar(db.n1, A);
    for (const k of ["gExiste", "gEvento", "gHab", "gWhen", "gFn"])
      assert.equal(linha(r, L[k]).vivo, "AUSENTE");
    // a função do gatilho e a validate continuam provadas: cada linha é do SEU objeto
    assert.equal(linha(r, L.fHash).ok, true);
    assert.equal(linha(r, L.vHash).ok, true);
  }
  // N2 desabilitado, ALWAYS, REPLICA
  for (const [rotulo, comando, letra] of [
    ["n2d", "DISABLE", "D"],
    ["n2a", "ENABLE ALWAYS", "A"],
    ["n2r", "ENABLE REPLICA", "R"],
  ]) {
    db[rotulo] = await novo(
      rotulo,
      `ALTER TABLE public.marketplace_orders ${comando} TRIGGER ${GATILHO}`,
      `${trig("tgenabled::text")} = '${letra}'`,
    );
    await negativo(A, `N2 ${comando}`, db[rotulo], [L.gHab]);
    assert.equal(linha(await rodar(db[rotulo], A), L.gHab).vivo, letra);
  }
  // N3 WHEN
  for (const [rotulo, clausula, guarda] of [
    [
      "n3a",
      `BEFORE INSERT ${FOR_ROW}`,
      `${trig("pg_get_triggerdef(oid)")} NOT LIKE '%WHEN%'`,
    ],
    [
      "n3b",
      `BEFORE INSERT ${FOR_ROW} WHEN (NEW.coupon_id IS NULL)`,
      `${trig("pg_get_triggerdef(oid)")} LIKE '%coupon_id IS NULL%'`,
    ],
    [
      "n3c",
      `BEFORE INSERT ${FOR_ROW} WHEN (NEW.coupon_id IS NOT NULL AND NEW.total > 0)`,
      `${trig("pg_get_triggerdef(oid)")} LIKE '%new.total%'`,
    ],
  ]) {
    db[rotulo] = await novo(rotulo, recriar(clausula), guarda);
    await negativo(A, `N3 ${rotulo}`, db[rotulo], [L.gWhen]);
  }
  assert.equal(linha(await rodar(db.n3a, A), L.gWhen).vivo, "sem WHEN");
  // N4 evento / função
  db.n4a = await novo(
    "n4a",
    recriar(`BEFORE INSERT OR UPDATE ${FOR_ROW} ${QUANDO}`),
    `(${trig("tgtype::int")} & 16) = 16`,
  );
  await negativo(A, "N4 BEFORE INSERT OR UPDATE", db.n4a, [L.gEvento]);
  assert.equal(
    linha(await rodar(db.n4a, A), L.gEvento).vivo,
    "BEFORE INSERT OR UPDATE FOR EACH ROW",
  );
  db.n4b = await novo(
    "n4b",
    recriar(`AFTER INSERT ${FOR_ROW} ${QUANDO}`),
    `(${trig("tgtype::int")} & 2) = 0`,
  );
  await negativo(A, "N4 AFTER INSERT", db.n4b, [L.gEvento]);
  db.n4c = await novo(
    "n4c",
    `CREATE FUNCTION public.pv_outra_funcao() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RETURN NEW; END $$;
     ${recriar(`BEFORE INSERT ${FOR_ROW} ${QUANDO}`, "public.pv_outra_funcao()")}`,
    `${trig("tgfoid::regproc::text")} LIKE '%pv_outra_funcao'`,
  );
  await negativo(A, "N4 aponta para outra função", db.n4c, [L.gFn]);
  ok(
    "10a reprova EXATAMENTE a linha do gatilho que divergiu: ausente (as 5 linhas dele, com AUSENTE), desabilitado (D), ENABLE ALWAYS (A) e REPLICA (R), sem WHEN / WHEN IS NULL / WHEN com condição a mais, BEFORE INSERT OR UPDATE, AFTER INSERT e gatilho apontando para outra função — o portão dá NEGATIVA em todos",
  );

  // N5 validate
  db.n5a = await novo("n5a", "SELECT 1", "true");
  await reescreverCorpo(db.n5a, SIG_V, (c) => `${c} `);
  await mutar(
    db.n5a,
    "n5a corpo +1 byte",
    "SELECT 1",
    `${HASH_DE(SIG_V)} NOT IN ('${HASH.vNovoLF}', '${HASH.vNovoCRLF}')`,
  );
  await negativo(A, "N5 corpo da validate com 1 byte a mais", db.n5a, [
    L.vHash,
  ]);
  assert.notEqual(linha(await rodar(db.n5a, A), L.vHash).vivo, HASH.vNovoLF);
  db.n5b = await novo("n5b", "SELECT 1", "true");
  {
    const corpoBase = await corpoDe(pre, SIG_V);
    await reescreverCorpo(db.n5b, SIG_V, () => corpoBase);
  }
  await mutar(
    db.n5b,
    "n5b corpo = baseline",
    "SELECT 1",
    `${HASH_DE(SIG_V)} = '${HASH.vBaseLF}'`,
  );
  await negativo(
    A,
    "N5 corpo da validate é o do baseline (migration pela metade)",
    db.n5b,
    [L.vHash],
  );
  assert.equal(linha(await rodar(db.n5b, A), L.vHash).vivo, HASH.vBaseLF);
  db.n5c = await novo(
    "n5c",
    `CREATE FUNCTION public.validate_coupon_secure_v2(p_code text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
    "(SELECT count(*) FROM pg_proc WHERE proname = 'validate_coupon_secure_v2') = 2",
  );
  await negativo(A, "N5 sobrecarga extra da validate", db.n5c, [L.vSobre]);
  db.n5d = await novo(
    "n5d",
    `ALTER FUNCTION ${SIG_V} SECURITY INVOKER`,
    `(SELECT NOT prosecdef FROM pg_proc WHERE oid = to_regprocedure('${SIG_V}'))`,
  );
  await negativo(A, "N5 validate SECURITY INVOKER", db.n5d, [L.vDef]);
  db.n5e = await novo(
    "n5e",
    `ALTER FUNCTION ${SIG_V} RESET search_path`,
    `(SELECT proconfig IS NULL FROM pg_proc WHERE oid = to_regprocedure('${SIG_V}'))`,
  );
  await negativo(A, "N5 validate sem search_path", db.n5e, [L.vSp]);
  assert.equal(linha(await rodar(db.n5e, A), L.vSp).vivo, "sem search_path");
  db.n5f = await novo(
    "n5f",
    `GRANT EXECUTE ON FUNCTION ${SIG_V} TO PUBLIC`,
    `EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = to_regprocedure('${SIG_V}') AND a.grantee = 0)`,
  );
  await negativo(A, "N5 validate com EXECUTE para PUBLIC", db.n5f, [L.vPub]);
  db.n5g = await novo(
    "n5g",
    `REVOKE EXECUTE ON FUNCTION ${SIG_V} FROM authenticated`,
    `NOT has_function_privilege('authenticated', to_regprocedure('${SIG_V}'), 'EXECUTE')`,
  );
  await negativo(A, "N5 validate sem EXECUTE para authenticated", db.n5g, [
    L.vAuth,
  ]);
  ok(
    "10a reprova EXATAMENTE a linha da validate_coupon_secure_v2: corpo com 1 byte a mais, corpo do baseline, sobrecarga extra, SECURITY INVOKER, sem search_path, EXECUTE para PUBLIC e authenticated revogado",
  );

  // N6 função do gatilho
  db.n6a = await novo("n6a", "SELECT 1", "true");
  await reescreverCorpo(db.n6a, SIG_G, (c) => `${c} `);
  await mutar(
    db.n6a,
    "n6a corpo +1 byte",
    "SELECT 1",
    `${HASH_DE(SIG_G)} NOT IN ('${HASH.gLF}', '${HASH.gCRLF}')`,
  );
  await negativo(A, "N6 corpo do gatilho com 1 byte a mais", db.n6a, [L.fHash]);
  db.n6b = await novo(
    "n6b",
    `ALTER FUNCTION ${SIG_G} RESET search_path`,
    `(SELECT proconfig IS NULL FROM pg_proc WHERE oid = to_regprocedure('${SIG_G}'))`,
  );
  await negativo(A, "N6 função do gatilho sem search_path", db.n6b, [L.fSp]);
  assert.equal(linha(await rodar(db.n6b, A), L.fSp).vivo, "sem search_path");
  db.n6c = await novo(
    "n6c",
    `ALTER FUNCTION ${SIG_G} SECURITY INVOKER`,
    `(SELECT NOT prosecdef FROM pg_proc WHERE oid = to_regprocedure('${SIG_G}'))`,
  );
  await negativo(A, "N6 função do gatilho SECURITY INVOKER", db.n6c, [L.fDef]);
  db.n6d = await novo(
    "n6d",
    `GRANT EXECUTE ON FUNCTION ${SIG_G} TO PUBLIC`,
    `EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = to_regprocedure('${SIG_G}') AND a.grantee = 0)`,
  );
  // PUBLIC alcança anon e authenticated: as TRÊS linhas de ACL reprovam
  await negativo(A, "N6 EXECUTE para PUBLIC no gatilho", db.n6d, [
    L.fPub,
    L.fAnon,
    L.fAuth,
  ]);
  db.n6e = await novo(
    "n6e",
    `GRANT EXECUTE ON FUNCTION ${SIG_G} TO anon`,
    `has_function_privilege('anon', to_regprocedure('${SIG_G}'), 'EXECUTE')`,
  );
  await negativo(A, "N6 EXECUTE para anon no gatilho", db.n6e, [L.fAnon]);
  db.n6f = await novo(
    "n6f",
    `GRANT EXECUTE ON FUNCTION ${SIG_G} TO authenticated`,
    `has_function_privilege('authenticated', to_regprocedure('${SIG_G}'), 'EXECUTE')`,
  );
  await negativo(A, "N6 EXECUTE para authenticated no gatilho", db.n6f, [
    L.fAuth,
  ]);
  ok(
    "10a reprova EXATAMENTE a linha da função do gatilho: corpo com 1 byte a mais, sem search_path, SECURITY INVOKER, EXECUTE para PUBLIC (as 3 linhas de ACL, porque PUBLIC alcança anon e authenticated), só anon e só authenticated",
  );

  // N7 índice
  const idx = (def) => `DROP INDEX public.${INDICE}; ${def}`;
  db.n7a = await novo(
    "n7a",
    `DROP INDEX public.${INDICE}`,
    `to_regclass('public.${INDICE}') IS NULL`,
  );
  await negativo(A, "N7 índice ausente", db.n7a, [L.iExiste, L.iDef]);
  const defIdx = `pg_get_indexdef('public.${INDICE}'::regclass)`;
  for (const [rotulo, def, esperado, guarda] of [
    [
      "n7b",
      `CREATE UNIQUE INDEX ${INDICE} ON public.marketplace_orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
      "UNIQUE marketplace_orders (user_id,idempotency_key) WHERE idempotency_key IS NOT NULL",
      `${defIdx} LIKE '%(user_id, idempotency_key)%'`,
    ],
    [
      "n7c",
      `CREATE UNIQUE INDEX ${INDICE} ON public.marketplace_orders (idempotency_key)`,
      "UNIQUE marketplace_orders (idempotency_key) WHERE sem predicado",
      `${defIdx} NOT LIKE '%WHERE%'`,
    ],
    [
      "n7d",
      `CREATE INDEX ${INDICE} ON public.marketplace_orders (idempotency_key) WHERE idempotency_key IS NOT NULL`,
      "NAO UNICO marketplace_orders (idempotency_key) WHERE idempotency_key IS NOT NULL",
      `${defIdx} NOT LIKE '%UNIQUE%'`,
    ],
  ]) {
    db[rotulo] = await novo(rotulo, idx(def), guarda);
    await negativo(A, `N7 ${rotulo}`, db[rotulo], [L.iDef]);
    assert.equal(linha(await rodar(db[rotulo], A), L.iDef).vivo, esperado);
  }
  ok(
    "10a reprova EXATAMENTE a linha do índice da chave de compra: ausente (existe + definição), por (user_id, chave), sem o parcial e não único — o curto-circuito do gatilho depende do predicado exato",
  );

  // ----------------------------------------------------------- 10b: NEGATIVOS
  const novoPre = async (rotulo, sqlMut, guarda) => {
    const nome = await clonar(rotulo, pre);
    await mutar(nome, rotulo, sqlMut, guarda);
    return nome;
  };
  db.b1 = await novoPre(
    "b1",
    `CREATE FUNCTION public.pedido_com_cupom_exige_a_chave_ligada() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
     CREATE TRIGGER ${GATILHO} BEFORE INSERT ${FOR_ROW} EXECUTE FUNCTION public.pedido_com_cupom_exige_a_chave_ligada();
     ALTER TABLE public.marketplace_orders DISABLE TRIGGER ${GATILHO}`,
    `${trig("tgenabled::text")} = 'D'`,
  );
  await negativo(B, "B1 gatilho presente (desabilitado)", db.b1, [LB.bGat]);
  db.b2 = await novoPre("b2", "SELECT 1", "true");
  await reescreverCorpo(db.b2, SIG_V, (c) => `${c} `);
  await mutar(
    db.b2,
    "b2 +1 byte",
    "SELECT 1",
    `${HASH_DE(SIG_V)} NOT IN ('${HASH.vBaseLF}', '${HASH.vBaseCRLF}')`,
  );
  await negativo(
    B,
    "B2 corpo da validate com 1 byte a mais que o baseline",
    db.b2,
    [LB.bHash],
  );
  db.b3 = await novoPre(
    "b3",
    `CREATE FUNCTION public.validate_coupon_secure_v2(p_code text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
    "(SELECT count(*) FROM pg_proc WHERE proname = 'validate_coupon_secure_v2') = 2",
  );
  await negativo(B, "B3 sobrecarga extra da validate", db.b3, [LB.bSobre]);
  db.b4 = await novoPre("b4", "SELECT 1", "true");
  {
    const corpoNovo = await corpoDe(aplicado, SIG_V);
    await reescreverCorpo(db.b4, SIG_V, () => corpoNovo);
  }
  await mutar(
    db.b4,
    "b4 corpo novo",
    "SELECT 1",
    `${HASH_DE(SIG_V)} = '${HASH.vNovoLF}'`,
  );
  await negativo(B, "B4 corpo NOVO sem o gatilho (meia migration)", db.b4, [
    LB.bHash,
  ]);
  db.b5 = await novoPre(
    "b5",
    "ALTER TABLE public.marketplace_orders RENAME COLUMN coupon_id TO pv_coupon_id",
    `NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.marketplace_orders'::regclass AND attname = 'coupon_id' AND NOT attisdropped)`,
  );
  await negativo(B, "B5 coluna coupon_id ausente", db.b5, [LB.bCoupon]);
  db.b6 = await novoPre(
    "b6",
    "ALTER TABLE public.store_config RENAME COLUMN enable_coupons TO pv_enable_coupons",
    `NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.store_config'::regclass AND attname = 'enable_coupons' AND NOT attisdropped)`,
  );
  await negativo(B, "B6 coluna enable_coupons ausente", db.b6, [LB.bEnable]);
  db.b7 = await novoPre(
    "b7",
    `DROP FUNCTION ${SIG_V}`,
    `to_regprocedure('${SIG_V}') IS NULL`,
  );
  await negativo(B, "B7 validate ausente", db.b7, [LB.bHash, LB.bSobre]);
  assert.equal(linha(await rodar(db.b7, B), LB.bHash).vivo, "AUSENTE");
  // a 10b na base JÁ APLICADA reprova nas duas linhas certas (trigger presente, corpo novo)
  await negativo(B, "B8 10b depois do apply", aplicado, [LB.bGat, LB.bHash]);
  await negativo(B, "B8 10b em cheio", cheio, [LB.bGat, LB.bHash]);
  // e a 10a na base pré reprova nas 13 linhas dos dois objetos que faltam
  await negativo(A, "A0 10a ANTES do apply", pre, [
    L.gExiste,
    L.gEvento,
    L.gHab,
    L.gWhen,
    L.gFn,
    L.fDef,
    L.fSp,
    L.fLang,
    L.fHash,
    L.fPub,
    L.fAnon,
    L.fAuth,
    L.vHash,
  ]);
  ok(
    "10b reprova EXATAMENTE a linha que divergiu: gatilho presente (mesmo desabilitado), corpo com 1 byte a mais que o baseline, sobrecarga extra, corpo NOVO sem gatilho, coluna coupon_id ou enable_coupons ausente, validate ausente; depois do apply a 10b reprova o gatilho e o corpo; a 10a ANTES do apply reprova as 13 linhas dos objetos que ainda não existem",
  );

  // ----------------------------------------------------------- MUTANTES
  const HASH_V = `'${HASH.vNovoLF}'`;
  await mutanteTemQueSerPego(
    "A: hash da validate ignorado",
    A,
    [["ELSE v.h END", `ELSE ${HASH_V} END`]],
    db.n5a,
    [L.vHash],
  );
  await mutanteTemQueSerPego(
    "A: validate aceita o corpo do baseline",
    A,
    [["ELSE v.h END", `ELSE ${HASH_V} END`]],
    db.n5b,
    [L.vHash],
  );
  await mutanteTemQueSerPego(
    "A: hash do gatilho ignorado",
    A,
    [["ELSE f.h END", `ELSE '${HASH.gLF}' END`]],
    db.n6a,
    [L.fHash],
  );
  await mutanteTemQueSerPego(
    "A: WHEN ignorado",
    A,
    [
      ["WHEN g.quando IS NULL THEN 'sem WHEN'", "WHEN false THEN 'sem WHEN'"],
      ["ELSE g.quando END", "ELSE 'new.coupon_id IS NOT NULL' END"],
    ],
    db.n3a,
    [L.gWhen],
  );
  await mutanteTemQueSerPego(
    "A: WHEN ignorado (condição diferente)",
    A,
    [
      ["WHEN g.quando IS NULL THEN 'sem WHEN'", "WHEN false THEN 'sem WHEN'"],
      ["ELSE g.quando END", "ELSE 'new.coupon_id IS NOT NULL' END"],
    ],
    db.n3b,
    [L.gWhen],
  );
  await mutanteTemQueSerPego(
    "A: habilitado ignorado",
    A,
    [
      [
        "COALESCE((SELECT g.tgenabled FROM gat g), 'AUSENTE')",
        "COALESCE((SELECT 'O' FROM gat g), 'AUSENTE')",
      ],
    ],
    db.n2d,
    [L.gHab],
  );
  await mutanteTemQueSerPego(
    "A: evento ignorado (BEFORE sempre)",
    A,
    [["WHEN g.tgtype & 2 = 2 THEN 'BEFORE'", "WHEN true THEN 'BEFORE'"]],
    db.n4b,
    [L.gEvento],
  );
  await mutanteTemQueSerPego(
    "A: search_path do gatilho ignorado",
    A,
    [
      [
        "COALESCE((SELECT COALESCE(array_to_string(f.proconfig, ','), 'sem search_path') FROM fg f), 'AUSENTE')",
        "COALESCE((SELECT 'search_path=public' FROM fg f), 'AUSENTE')",
      ],
    ],
    db.n6b,
    [L.fSp],
  );
  await mutanteTemQueSerPego(
    "A: ACL de anon ignorada",
    A,
    [
      [
        "has_function_privilege('anon', p.oid, 'EXECUTE') END AS exec_anon",
        "false END AS exec_anon",
      ],
    ],
    db.n6e,
    [L.fAnon],
  );
  await mutanteTemQueSerPego(
    "A: predicado do índice ignorado",
    A,
    [
      [
        "WHEN x.predicado IS NULL THEN 'sem predicado'",
        "WHEN false THEN 'sem predicado'",
      ],
      ["ELSE x.predicado END", "ELSE 'idempotency_key IS NOT NULL' END"],
    ],
    db.n7c,
    [L.iDef],
  );
  await mutanteTemQueSerPego(
    "B: presença do gatilho ignorada",
    B,
    [
      [
        "WHERE t.tgname = 'tr_pedido_com_cupom_exige_a_chave_ligada')",
        "WHERE false)",
      ],
    ],
    db.b1,
    [LB.bGat],
  );
  await mutanteTemQueSerPego(
    "B: baseline ignorado",
    B,
    [["ELSE v.h END", `ELSE '${HASH.vBaseLF}' END`]],
    db.b2,
    [LB.bHash],
  );
  await mutanteTemQueSerPego(
    "B: aceita também o corpo NOVO",
    B,
    [
      [
        "CASE WHEN v.h IN ('5fefbbe6",
        `CASE WHEN v.h IN ('${HASH.vNovoLF}', '5fefbbe6`,
      ],
    ],
    db.b4,
    [LB.bHash],
  );
  ok(
    "13 MUTANTES do texto das consultas (hash da validate, baseline como corpo novo, hash do gatilho, WHEN ausente e com outra condição, habilitado, evento, search_path, ACL de anon, predicado do índice; na 10b a presença do gatilho, o baseline e o aceite do corpo novo) deixam o negativo correspondente PASSAR menos reprovado — a prova ficaria VERMELHA",
  );

  // ----------------------------------------------------------- ROL FECHADO
  {
    const rows = await rodar(pre, A);
    const parcial = rows.filter((r) => r.ok === true);
    assert.ok(parcial.length > 0 && parcial.length < rows.length);
    assert.ok(
      parcial.every((r) => r.ok === true),
      "todas as presentes são ok=true",
    );
    const v = veredito(A, parcial);
    assert.ok(v.endsWith("rol=invalido"), v);
    assert.equal(
      (await portaoComLog(A, v)).estado,
      "SEM_EVIDENCIA",
      "resposta PARCIAL com tudo ok=true nunca é positiva",
    );
    const dup = [...(await rodar(cheio, A)), (await rodar(cheio, A))[0]];
    assert.ok(veredito(A, dup).endsWith("rol=invalido"));
    assert.equal(
      (await portaoComLog(A, veredito(A, dup))).estado,
      "SEM_EVIDENCIA",
    );
    // o rol de uma consulta não vale para a outra
    const rowsB = await rodar(pre, B);
    assert.ok(veredito(A, rowsB).endsWith("rol=invalido"));
    ok(
      "rol FECHADO: a resposta PARCIAL (só as linhas ok=true), com linha duplicada ou com o rol da OUTRA consulta tem rol=invalido e o portão a trata como SEM_EVIDENCIA, nunca POSITIVA",
    );
  }

  // ----------------------------------------------------------- ERRO DE SQL
  {
    const quebrado = SQL[A].replace(
      "SELECT item, esperado, vivo, COALESCE",
      "SELEC item, esperado, vivo, COALESCE",
    );
    assert.notEqual(quebrado, SQL[A]);
    const r = await tentar(cheio, A, { sql: quebrado });
    assert.ok(r.erro && r.erro.code === "42601", String(r.erro));
    assert.equal(r.rows, undefined);
    assert.equal(
      (await portaoComLog(A, null, "success")).estado,
      "SEM_EVIDENCIA",
    );
    assert.equal(
      (await portaoComLog(A, null, "failure")).estado,
      "SEM_EVIDENCIA",
    );
    ok(
      "erro de SQL (42601): falha ALTA, nenhuma linha, e o portão fica SEM_EVIDENCIA mesmo com o run verde — erro nunca vira positivo",
    );
  }

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
    // o run "de verdade": o log do processo filho vira a evidência do portão
    let reloginho = Date.parse("2026-10-08T13:00:00Z");
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
    assert.ok(lote, "o canais-de-backend.json real não declara o lote da 10a");
    assert.deepEqual(lote.versoes, [VERSAO]);
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
        `o lote não devia declarar ${campo}`,
      );
    /** Lê as duas consultas contra `dbAlvo` pelo processo de verdade e decide o lote. */
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
          lote: { ...lote, versoes: [VERSAO] },
          faltam,
          exigeProva,
          prova,
          diagnostico: diag,
        }),
      };
    };
    try {
      // E1: o veredito real do processo filho
      const e1 = await executar(cheio, A);
      assert.equal(e1.codigo, 0, e1.saida);
      assert.deepEqual(PORTAO.lerVeredicto(e1.saida, A), {
        ref: REF_SAVY,
        sha: SHA40,
        linhas: 21,
        okFalse: 0,
        naoBooleano: 0,
        rol: "ok",
      });
      const e1b = await executar(pre, B);
      assert.deepEqual(PORTAO.lerVeredicto(e1b.saida, B), {
        ref: REF_SAVY,
        sha: SHA40,
        linhas: 6,
        okFalse: 0,
        naoBooleano: 0,
        rol: "ok",
      });
      // E2: banco inexistente → HTTP 400, saída 1, NENHUM veredito, SEM_EVIDENCIA
      const e2 = await executar("pv_banco_que_nao_existe", A);
      assert.equal(e2.codigo, 1, e2.saida);
      assert.ok(!e2.saida.includes("VEREDITO-CONSULTA"), e2.saida);
      assert.equal((await evidencia(A, e2.saida)).estado, "SEM_EVIDENCIA");

      // L1: loja ANTES do apply (ledger sem a versão): 10a NEGATIVA + 10b POSITIVA → APLICAR
      const l1 = await decidir(pre, { faltam: [VERSAO], exigeProva: true });
      assert.equal(l1.prova.estado, "NEGATIVA");
      assert.equal(l1.diag.estado, "POSITIVA");
      assert.equal(l1.decisao.acao, "APLICAR", JSON.stringify(l1.decisao));
      assert.deepEqual(l1.decisao.versoes, [VERSAO]);
      // L2: loja DEPOIS do apply, ledger com a versão: 10a POSITIVA → NADA
      const l2 = await decidir(aplicado, { faltam: [], exigeProva: true });
      assert.equal(l2.prova.estado, "POSITIVA");
      assert.equal(l2.decisao.acao, "NADA", JSON.stringify(l2.decisao));
      // L3: objetos no banco mas o ledger SEM a versão e sem backfillLedger → PARAR, nenhum apply
      const l3 = await decidir(aplicado, {
        faltam: [VERSAO],
        exigeProva: true,
      });
      assert.equal(l3.prova.estado, "POSITIVA");
      assert.equal(l3.decisao.acao, "PARAR", JSON.stringify(l3.decisao));
      assert.match(l3.decisao.motivo, /não declara backfillLedger/);
      // L4: ledger com a versão mas gatilho DESABILITADO (10a e 10b negativas) → PARAR
      const l4 = await decidir(db.n2d, { faltam: [], exigeProva: true });
      assert.equal(l4.prova.estado, "NEGATIVA");
      assert.equal(l4.decisao.acao, "PARAR", JSON.stringify(l4.decisao));
      // L5: ledger sem a versão, 10a NEGATIVA, mas a 10b NEGATIVA (corpo da validate fora do baseline) → PARAR
      const l5 = await decidir(db.b2, { faltam: [VERSAO], exigeProva: true });
      assert.equal(l5.prova.estado, "NEGATIVA");
      assert.equal(l5.diag.estado, "NEGATIVA");
      assert.equal(l5.decisao.acao, "PARAR", JSON.stringify(l5.decisao));
      ok(
        "ponta a ponta (conferir-banco.cjs de verdade, HTTP local, papel de leitura, canais-de-backend.json REAL): ANTES do apply 10a NEGATIVA + 10b POSITIVA → APLICAR [20261203000000]; depois do apply 10a POSITIVA → NADA; objetos sem a versão no ledger → PARAR (sem backfill, sem apply); gatilho desabilitado → PARAR; 10b negativa → PARAR; banco inexistente → saída 1, sem veredito, SEM_EVIDENCIA",
      );
    } finally {
      await api.parar();
    }
  }

  console.log(`\n[cupons-desligados-portao-viva] ${resultados} provas ok`);
}

main()
  .catch((erro) => {
    console.error("\n[FALHOU]", erro?.stack ? erro.stack : erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const n of clones) {
      await usar("template1", (a) =>
        a.query(`DROP DATABASE IF EXISTS "${n}"`),
      ).catch(() => {});
    }
    for (const papel of Object.values(P)) {
      await usar("template1", (a) =>
        a.query(`DROP ROLE IF EXISTS ${papel}`),
      ).catch(() => {});
    }
  });

// `falhar` fica importado para o caso de a trava de efemero recusar antes.
void falhar;
