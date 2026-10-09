"use strict";

/**
 * Prova VIVA das duas consultas do PORTÃO DA RELEASE para a migration
 * 20261204000000 (a venda do balcão se anula no mesmo dia), num Postgres
 * EFÊMERO local — nada de rede, nada de loja:
 *   11a-conferir-anular-venda-presencial-aplicado.sql        (DEPOIS do apply: 14 linhas)
 *   11b-antes-anular-venda-presencial-funcao-ausente.sql     (ANTES do apply: 8 linhas)
 * Elas são a "prova de objetos" do lote 20261204000000 em
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
 *   cheio     a árvore inteira de migrations (com a 20261204000000);
 *   pre       a árvore SEM a 20261204000000 (o estado de uma loja antes do apply);
 *   aplicado  `pre` + o ARQUIVO da migration aplicado de verdade (LF);
 *   crlf      `pre` + o arquivo da migration com fim de linha CRLF (checkout Windows).
 *
 * CASOS (cada um com a LINHA exata que reprova; o veredito real, com rol=ok e o
 * ok_false esperado, é conferido em TODO caso):
 *  POSITIVOS  11b em `pre`; 11a em `cheio`, em `aplicado` (IGUAL linha a linha ao
 *             `cheio`) e em `crlf`; as duas com o papel mínimo e com search_path
 *             trocado e objetos-isca de mesmo nome em outro schema.
 *  11a        N1 função ausente; N2 sobrecarga extra; N3 só OUTRA assinatura (a de 1
 *             argumento); N4 SECURITY INVOKER; N5 sem search_path; N6 linguagem sql;
 *             N7 corpo com 1 byte a mais; N8 EXECUTE para PUBLIC (3 linhas), anon,
 *             service_role e authenticated revogado; N9 cada dependência ausente.
 *  11b        B1 função já existe; B2 corpo da is_admin_atual e da pedido__mudar_status
 *             com 1 byte a mais; B3 cada dependência ausente; B4 tabela ausente; B5
 *             coluna ausente; na base `aplicado` a 11b reprova só a linha da função.
 *  MUTANTES   cada cláusula da consulta, desligada no texto do .sql, deixa um
 *             negativo PASSAR e esta prova ficaria VERMELHA.
 *  FECHADO    resposta PARCIAL e linha duplicada têm rol=invalido: o portão NUNCA as
 *             trata como positivas.
 *  ERRO       SQL truncado (42601) e banco inexistente: falha ALTA, nenhuma linha
 *             VEREDITO-CONSULTA, o portão fica SEM_EVIDENCIA mesmo com o run verde.
 *  PONTA A PONTA  conferir-banco.cjs de verdade (processo filho, HTTP local) e o
 *             LOTE do canais-de-backend.json REAL no `decidirLote`: ledger sem a
 *             versão + 11a NEGATIVA + 11b POSITIVA → APLICAR; 11a POSITIVA → PARAR
 *             (sem backfillLedger); ledger com a versão + 11a POSITIVA → NADA; as
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
 *        node tests/banco/rodar-isolado.cjs tests/banco/anular-venda-portao-viva.cjs
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
const { createHash } = require("node:crypto");
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

const A = "11a-conferir-anular-venda-presencial-aplicado";
const B = "11b-antes-anular-venda-presencial-funcao-ausente";
const VERSAO = "20261204000000";
const ARQUIVO = "20261204000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql";
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const SHA40 = "d".repeat(40);
const SQL = {
  [A]: fs.readFileSync(path.join(CONSULTAS, `${A}.sql`), "utf8"),
  [B]: fs.readFileSync(path.join(CONSULTAS, `${B}.sql`), "utf8"),
};
const ROL = { [A]: CONF.ROL_DA_11A, [B]: CONF.ROL_DA_11B };
const N_LINHAS = { [A]: 14, [B]: 8 };

const SIG_F = "public.anular_venda_presencial(uuid,text)";
const SIG_ADMIN = "public.is_admin_atual()";
const SIG_MUDAR =
  "public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)";
const SIG_ESTOQUE = "public.devolver_estoque(uuid)";
const SIG_DIA = "public.fin__dia(timestamptz)";
const SIG_HOJE = "public.fin__hoje()";

// Os hashes do corpo da função são recalculados do ARQUIVO da migration (e conferidos
// contra o que a consulta 11a e o rollback-manual aceitam): nenhum literal solto aqui.
const CORPO_LF = (() => {
  const lf = fs
    .readFileSync(path.join(MIGRATIONS, ARQUIVO), "utf8")
    .replace(/\r\n/g, "\n");
  const m = lf.match(
    /CREATE OR REPLACE FUNCTION public\.anular_venda_presencial\(p_order_id uuid, p_motivo text\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/,
  );
  assert.ok(m, "não achei o corpo da função na migration");
  return m[1];
})();
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const HASH = {
  fLF: sha(CORPO_LF),
  fCRLF: sha(CORPO_LF.replace(/\n/g, "\r\n")),
};
const HASH_DE = (sig) =>
  `(SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = to_regprocedure('${sig}'))`;
const MD5_ADMIN = "519842163e48cc377ac1337ffb9db936";
const MD5_MUDAR = "4623b27a07468553d6ac00a888e04db4";

// Os nomes das linhas (o rol fechado do código tem os mesmos).
const F = "anular_venda_presencial";
const L = {
  controle: "controle: funcoes de public visiveis a este papel",
  sobre: `${F}: sobrecargas`,
  def: `${F}: SECURITY DEFINER`,
  sp: `${F}: search_path`,
  lang: `${F}: linguagem e retorno`,
  hash: `${F}: corpo (sha256)`,
  pub: `${F}: EXECUTE para PUBLIC`,
  anon: `${F}: EXECUTE para anon`,
  auth: `${F}: EXECUTE para authenticated`,
  service: `${F}: EXECUTE para service_role`,
  dAdmin: "dependencia is_admin_atual(): existe",
  dMudar: "dependencia pedido__mudar_status(...): existe",
  dEstoque: "dependencia devolver_estoque(uuid): existe",
  dFin: "dependencia fin__dia e fin__hoje: existem",
};
// As 9 linhas que dependem da função existir (o que uma loja ANTES do apply reprova).
const DA_FUNCAO = [
  L.sobre,
  L.def,
  L.sp,
  L.lang,
  L.hash,
  L.pub,
  L.anon,
  L.auth,
  L.service,
];
const LB = {
  controle: L.controle,
  ausente: `${F}: ausente`,
  mAdmin: "dependencia is_admin_atual(): corpo e o esperado (md5)",
  mMudar: "dependencia pedido__mudar_status(...): corpo e o esperado (md5)",
  dEstoque: "dependencia devolver_estoque(uuid): existe",
  dFin: "dependencia fin__dia e fin__hoje: existem",
  tabelas: "tabelas usadas: existem",
  colunas: "colunas usadas: existem",
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
 * booleano, `ok=false` primeiro, nenhuma coluna de linha de pedido, venda ou cliente. */
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
    ordena(CONF.ROL_DA_11A),
    ordena(Object.values(L)),
    "o rol da 11a do código é o conjunto de itens que esta prova conhece",
  );
  assert.deepEqual(
    ordena(CONF.ROL_DA_11B),
    ordena(Object.values(LB)),
    "o rol da 11b do código é o conjunto de itens que esta prova conhece",
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
      funcao: (
        await c.query("SELECT to_regprocedure($1) IS NOT NULL AS e", [SIG_F])
      ).rows[0].e,
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
      papeis: (
        await c.query(
          "SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')",
        )
      ).rows[0].n,
    }));
    assert.equal(
      sonda.funcao,
      true,
      "precondição: a árvore inteira tem a função",
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
    assert.equal(sonda.papeis, 3, "precondição: os 3 papéis de fábrica");
    // o que a 11a e o rollback aceitam é o que o ARQUIVO da migration define
    assert.ok(
      SQL[A].includes(`'${HASH.fLF}'`) && SQL[A].includes(`'${HASH.fCRLF}'`),
    );
    const rollback = fs.readFileSync(
      path.join(MIGRATIONS, `rollback-manual-${ARQUIVO}`),
      "utf8",
    );
    assert.ok(
      rollback.includes(`'${HASH.fLF}'`) &&
        rollback.includes(`'${HASH.fCRLF}'`),
    );
    ok(
      "precondição: banco migrado com a árvore inteira (função presente), vazio, conexão superusuário, 3 papéis de fábrica; os dois sha256 do corpo (LF e CRLF) que a 11a e o rollback aceitam são os do ARQUIVO da migration",
    );
  }

  // ----------------------------------------------------------- as bases
  const cheio = await clonar("cheio");
  const pre = `pv_${SUF}_pre`.slice(0, 60);
  await montarBase(pre, (f) => f !== ARQUIVO);
  {
    const sonda = await usar(pre, async (c) => ({
      funcao: (
        await c.query("SELECT to_regprocedure($1) IS NOT NULL AS e", [SIG_F])
      ).rows[0].e,
      admin: (
        await c.query(
          `SELECT md5(replace(prosrc, E'\\r', '')) AS m FROM pg_proc WHERE oid = to_regprocedure('${SIG_ADMIN}')`,
        )
      ).rows[0].m,
      mudar: (
        await c.query(
          `SELECT md5(replace(prosrc, E'\\r', '')) AS m FROM pg_proc WHERE oid = to_regprocedure('${SIG_MUDAR}')`,
        )
      ).rows[0].m,
    }));
    assert.deepEqual(sonda, {
      funcao: false,
      admin: MD5_ADMIN,
      mudar: MD5_MUDAR,
    });
  }
  const aplicado = await clonar("aplicado", pre);
  aplicarMigration(aplicado);
  const crlf = await clonar("crlf", pre);
  aplicarMigration(crlf, { crlf: true });
  ok(
    "bases montadas: cheio (árvore inteira), pre (sem a 20261204000000: sem a função, as duas dependências com o corpo do pré-voo), aplicado (pre + o ARQUIVO aplicado, LF) e crlf (idem, arquivo em CRLF)",
  );

  // ----------------------------------------------------------- POSITIVOS
  const rowsCheio = await rodar(cheio, A);
  await exigirPositiva(A, "11a em cheio", rowsCheio);
  {
    const rowsAplicado = await rodar(aplicado, A);
    await exigirPositiva(A, "11a em aplicado", rowsAplicado);
    assert.deepEqual(
      rowsAplicado,
      rowsCheio,
      "o apply isolado do ARQUIVO sobre a base pré é indistinguível da árvore inteira",
    );
    assert.equal(linha(rowsAplicado, L.hash).vivo, HASH.fLF);
    const rowsCrlf = await rodar(crlf, A);
    await exigirPositiva(A, "11a em crlf", rowsCrlf);
    assert.equal(linha(rowsCrlf, L.hash).vivo, HASH.fLF);
    await usar(crlf, async (c) => {
      const h = (await c.query(`SELECT ${HASH_DE(SIG_F)} AS f`)).rows[0];
      assert.equal(
        h.f,
        HASH.fCRLF,
        "guarda: o corpo da função ficou em CRLF no banco",
      );
    });
    ok(
      "11a POSITIVA (14 linhas, rol=ok, portão POSITIVA) na árvore inteira, no ARQUIVO aplicado sobre a base pré (resposta IDÊNTICA linha a linha) e no arquivo aplicado em CRLF (corpo gravado em CRLF, hash CRLF aceito)",
    );
  }
  {
    const rows = await rodar(pre, B);
    await exigirPositiva(B, "11b em pre", rows);
    assert.equal(linha(rows, LB.mAdmin).vivo, MD5_ADMIN);
    assert.equal(linha(rows, LB.mMudar).vivo, MD5_MUDAR);
    assert.equal(linha(rows, LB.ausente).vivo, "0");
    ok(
      "11b POSITIVA (8 linhas, rol=ok, portão POSITIVA) na base SEM a migration: função ausente, md5 das duas dependências, tabelas e colunas presentes",
    );
  }
  {
    // outro papel e outro search_path: as consultas só leem catálogo e nomeiam tudo
    // com `public.`; objetos-isca de mesmo nome em outro schema não mudam nada.
    const isca = `CREATE SCHEMA pv_isca;
       CREATE TABLE pv_isca.marketplace_orders (id int, status int);
       CREATE FUNCTION pv_isca.anular_venda_presencial(p_order_id uuid, p_motivo text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
       CREATE FUNCTION pv_isca.is_admin_atual() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
       GRANT USAGE ON SCHEMA pv_isca TO PUBLIC`;
    const iscas = await clonar("iscas", aplicado);
    await mutar(
      iscas,
      "schema de iscas",
      isca,
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
        `11a ${rotulo}`,
        await rodar(iscas, A, { papel, antes }),
      );
    }
    await exigirPositiva(
      B,
      "11b papel mínimo",
      await rodar(pre, B, { papel: P.minimo }),
    );
    // no banco PRÉ com iscas à frente do search_path (a isca da função de mesmo nome
    // NÃO pode contar como "a função existe"), a 11b segue positiva
    const preIscas = await clonar("preiscas", pre);
    await mutar(
      preIscas,
      "iscas no pre",
      isca,
      "to_regclass('pv_isca.marketplace_orders') IS NOT NULL",
    );
    await exigirPositiva(
      B,
      "11b com iscas",
      await rodar(preIscas, B, {
        antes: ["SET search_path = pv_isca, pg_catalog"],
      }),
    );
    ok(
      "11a e 11b POSITIVAS também com o papel mínimo, com search_path trocado e com objetos-isca de mesmo nome em outro schema (tudo é nomeado com public.)",
    );
  }

  // ----------------------------------------------------------- 11a: NEGATIVOS
  const db = {};
  const novo = async (rotulo, sqlMut, guarda) => {
    const nome = await clonar(rotulo, cheio);
    await mutar(nome, rotulo, sqlMut, guarda);
    return nome;
  };
  const acl = (sig, quem) =>
    `EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = to_regprocedure('${sig}') AND a.grantee = ${quem})`;
  const nFuncoes = `(SELECT count(*) FROM pg_proc WHERE proname = 'anular_venda_presencial')`;

  // N1 função ausente: as 9 linhas dela, todas AUSENTE; as dependências seguem provadas
  db.n1 = await novo(
    "n1",
    `DROP FUNCTION ${SIG_F}`,
    `to_regprocedure('${SIG_F}') IS NULL`,
  );
  await negativo(A, "N1 função ausente", db.n1, [
    L.sobre,
    L.def,
    L.sp,
    L.lang,
    L.hash,
    L.pub,
    L.anon,
    L.auth,
    L.service,
  ]);
  {
    const r = await rodar(db.n1, A);
    for (const k of [
      "def",
      "sp",
      "lang",
      "hash",
      "pub",
      "anon",
      "auth",
      "service",
    ])
      assert.equal(linha(r, L[k]).vivo, "AUSENTE");
    assert.equal(linha(r, L.sobre).vivo, "0");
    for (const k of ["dAdmin", "dMudar", "dEstoque", "dFin"])
      assert.equal(linha(r, L[k]).ok, true, `${k} continua provada`);
  }
  // 11a ANTES do apply
  await negativo(A, "N1b 11a ANTES do apply", pre, DA_FUNCAO);
  // N2 sobrecarga extra
  db.n2 = await novo(
    "n2",
    `CREATE FUNCTION public.anular_venda_presencial(p_order_id uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
    `${nFuncoes} = 2`,
  );
  await negativo(A, "N2 sobrecarga extra", db.n2, [L.sobre]);
  // N3 só OUTRA assinatura: a de 2 argumentos some, fica uma de 1 argumento
  db.n3 = await novo(
    "n3",
    `DROP FUNCTION ${SIG_F};
     CREATE FUNCTION public.anular_venda_presencial(p_order_id uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
    `to_regprocedure('${SIG_F}') IS NULL AND ${nFuncoes} = 1`,
  );
  await negativo(A, "N3 só outra assinatura", db.n3, [
    L.def,
    L.sp,
    L.lang,
    L.hash,
    L.pub,
    L.anon,
    L.auth,
    L.service,
  ]);
  // N4 SECURITY INVOKER
  db.n4 = await novo(
    "n4",
    `ALTER FUNCTION ${SIG_F} SECURITY INVOKER`,
    `(SELECT NOT prosecdef FROM pg_proc WHERE oid = to_regprocedure('${SIG_F}'))`,
  );
  await negativo(A, "N4 SECURITY INVOKER", db.n4, [L.def]);
  assert.equal(linha(await rodar(db.n4, A), L.def).vivo, "false");
  // N5 sem search_path
  db.n5 = await novo(
    "n5",
    `ALTER FUNCTION ${SIG_F} RESET search_path`,
    `(SELECT proconfig IS NULL FROM pg_proc WHERE oid = to_regprocedure('${SIG_F}'))`,
  );
  await negativo(A, "N5 sem search_path", db.n5, [L.sp]);
  assert.equal(linha(await rodar(db.n5, A), L.sp).vivo, "sem search_path");
  // N5b search_path diferente
  db.n5b = await novo(
    "n5b",
    `ALTER FUNCTION ${SIG_F} SET search_path = public, pg_temp`,
    `(SELECT array_to_string(proconfig, ',') = 'search_path=public, pg_temp' FROM pg_proc WHERE oid = to_regprocedure('${SIG_F}'))`,
  );
  await negativo(A, "N5b search_path com pg_temp", db.n5b, [L.sp]);
  // N6 linguagem sql
  db.n6 = await novo(
    "n6",
    `CREATE OR REPLACE FUNCTION public.anular_venda_presencial(p_order_id uuid, p_motivo text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT '{}'::jsonb $$`,
    `(SELECT l.lanname = 'sql' FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('${SIG_F}'))`,
  );
  await negativo(A, "N6 linguagem sql", db.n6, [L.lang, L.hash]);
  assert.equal(linha(await rodar(db.n6, A), L.lang).vivo, "sql jsonb");
  // N7 corpo com 1 byte a mais
  db.n7 = await novo("n7", "SELECT 1", "true");
  await reescreverCorpo(db.n7, SIG_F, (c) => `${c} `);
  await mutar(
    db.n7,
    "n7 corpo +1 byte",
    "SELECT 1",
    `${HASH_DE(SIG_F)} NOT IN ('${HASH.fLF}', '${HASH.fCRLF}')`,
  );
  await negativo(A, "N7 corpo com 1 byte a mais", db.n7, [L.hash]);
  assert.notEqual(linha(await rodar(db.n7, A), L.hash).vivo, HASH.fLF);
  // N7b corpo com UM caractere trocado (mesmo tamanho)
  db.n7b = await novo("n7b", "SELECT 1", "true");
  await reescreverCorpo(db.n7b, SIG_F, (c) => {
    assert.ok(c.includes("42501"));
    return c.replace("42501", "42502");
  });
  await mutar(
    db.n7b,
    "n7b corpo trocado",
    "SELECT 1",
    `${HASH_DE(SIG_F)} NOT IN ('${HASH.fLF}', '${HASH.fCRLF}')`,
  );
  await negativo(A, "N7b corpo com um caractere trocado", db.n7b, [L.hash]);
  ok(
    "11a reprova EXATAMENTE a linha da função que divergiu: ausente (as 9 linhas dela com AUSENTE, e as 4 dependências seguem provadas), ANTES do apply (as mesmas 9), sobrecarga extra, só outra assinatura, SECURITY INVOKER, sem search_path, search_path com pg_temp, linguagem sql, corpo com 1 byte a mais e com um caractere trocado — o portão dá NEGATIVA em todos",
  );

  // N8 ACL
  db.n8pub = await novo(
    "n8pub",
    `GRANT EXECUTE ON FUNCTION ${SIG_F} TO PUBLIC`,
    acl(SIG_F, 0),
  );
  // PUBLIC alcança anon e service_role: as TRÊS linhas reprovam (authenticated segue 'sim')
  await negativo(A, "N8 EXECUTE para PUBLIC", db.n8pub, [
    L.pub,
    L.anon,
    L.service,
  ]);
  db.n8anon = await novo(
    "n8anon",
    `GRANT EXECUTE ON FUNCTION ${SIG_F} TO anon`,
    `has_function_privilege('anon', to_regprocedure('${SIG_F}'), 'EXECUTE')`,
  );
  await negativo(A, "N8 EXECUTE para anon", db.n8anon, [L.anon]);
  db.n8service = await novo(
    "n8service",
    `GRANT EXECUTE ON FUNCTION ${SIG_F} TO service_role`,
    `has_function_privilege('service_role', to_regprocedure('${SIG_F}'), 'EXECUTE')`,
  );
  await negativo(A, "N8 EXECUTE para service_role", db.n8service, [L.service]);
  db.n8auth = await novo(
    "n8auth",
    `REVOKE EXECUTE ON FUNCTION ${SIG_F} FROM authenticated`,
    `NOT has_function_privilege('authenticated', to_regprocedure('${SIG_F}'), 'EXECUTE')`,
  );
  await negativo(A, "N8 authenticated sem EXECUTE", db.n8auth, [L.auth]);
  assert.equal(linha(await rodar(db.n8auth, A), L.auth).vivo, "nao");
  ok(
    "11a reprova EXATAMENTE a linha da ACL: PUBLIC (3 linhas, porque PUBLIC alcança anon e service_role), só anon, só service_role e authenticated revogado",
  );

  // N9 dependências ausentes (renomeadas: sem arrastar quem as usa no catálogo)
  const renomear = async (rotulo, sig, novoNome) => {
    const [, nome, args] = sig.match(/^public\.(\w+)(\(.*\))$/);
    return novo(
      rotulo,
      `ALTER FUNCTION public.${nome}${args} RENAME TO ${novoNome}`,
      `to_regprocedure('${sig}') IS NULL`,
    );
  };
  db.n9admin = await renomear("n9admin", SIG_ADMIN, "pv_is_admin_atual");
  await negativo(A, "N9 is_admin_atual ausente", db.n9admin, [L.dAdmin]);
  db.n9mudar = await renomear("n9mudar", SIG_MUDAR, "pv_mudar_status");
  await negativo(A, "N9 pedido__mudar_status ausente", db.n9mudar, [L.dMudar]);
  db.n9estoque = await renomear(
    "n9estoque",
    SIG_ESTOQUE,
    "pv_devolver_estoque",
  );
  await negativo(A, "N9 devolver_estoque ausente", db.n9estoque, [L.dEstoque]);
  db.n9dia = await renomear("n9dia", SIG_DIA, "pv_fin_dia");
  await negativo(A, "N9 fin__dia ausente", db.n9dia, [L.dFin]);
  db.n9hoje = await renomear("n9hoje", SIG_HOJE, "pv_fin_hoje");
  await negativo(A, "N9 fin__hoje ausente", db.n9hoje, [L.dFin]);
  assert.equal(linha(await rodar(db.n9admin, A), L.dAdmin).vivo, "AUSENTE");
  ok(
    "11a reprova EXATAMENTE a linha da dependência que sumiu: is_admin_atual, pedido__mudar_status, devolver_estoque, fin__dia e fin__hoje (as duas últimas dividem a linha)",
  );

  // ----------------------------------------------------------- 11b: NEGATIVOS
  const novoPre = async (rotulo, sqlMut, guarda) => {
    const nome = await clonar(rotulo, pre);
    await mutar(nome, rotulo, sqlMut, guarda);
    return nome;
  };
  // B1 a função já existe (qualquer corpo)
  await negativo(B, "B1 função já existe (árvore inteira)", cheio, [
    LB.ausente,
  ]);
  await negativo(B, "B1 função já existe (depois do apply)", aplicado, [
    LB.ausente,
  ]);
  db.b1 = await novoPre(
    "b1",
    `CREATE FUNCTION public.anular_venda_presencial(p_order_id uuid, p_motivo text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
    `to_regprocedure('${SIG_F}') IS NOT NULL`,
  );
  await negativo(B, "B1 função de outro corpo já existe", db.b1, [LB.ausente]);
  assert.equal(linha(await rodar(db.b1, B), LB.ausente).vivo, "1");
  // B2/B3 corpo das dependências com 1 byte a mais
  db.b2 = await novoPre("b2", "SELECT 1", "true");
  await reescreverCorpo(db.b2, SIG_ADMIN, (c) => `${c} `);
  await mutar(
    db.b2,
    "b2 is_admin_atual +1 byte",
    "SELECT 1",
    `(SELECT md5(replace(prosrc, E'\\r', '')) FROM pg_proc WHERE oid = to_regprocedure('${SIG_ADMIN}')) <> '${MD5_ADMIN}'`,
  );
  await negativo(B, "B2 corpo da is_admin_atual com 1 byte a mais", db.b2, [
    LB.mAdmin,
  ]);
  db.b3 = await novoPre("b3", "SELECT 1", "true");
  await reescreverCorpo(db.b3, SIG_MUDAR, (c) => `${c} `);
  await mutar(
    db.b3,
    "b3 pedido__mudar_status +1 byte",
    "SELECT 1",
    `(SELECT md5(replace(prosrc, E'\\r', '')) FROM pg_proc WHERE oid = to_regprocedure('${SIG_MUDAR}')) <> '${MD5_MUDAR}'`,
  );
  await negativo(
    B,
    "B3 corpo da pedido__mudar_status com 1 byte a mais",
    db.b3,
    [LB.mMudar],
  );
  // B4 dependência ausente
  const renomearPre = async (rotulo, sig, novoNome) => {
    const [, nome, args] = sig.match(/^public\.(\w+)(\(.*\))$/);
    return novoPre(
      rotulo,
      `ALTER FUNCTION public.${nome}${args} RENAME TO ${novoNome}`,
      `to_regprocedure('${sig}') IS NULL`,
    );
  };
  db.b4admin = await renomearPre("b4admin", SIG_ADMIN, "pv_is_admin_atual");
  await negativo(B, "B4 is_admin_atual ausente", db.b4admin, [LB.mAdmin]);
  assert.equal(linha(await rodar(db.b4admin, B), LB.mAdmin).vivo, "AUSENTE");
  db.b4mudar = await renomearPre("b4mudar", SIG_MUDAR, "pv_mudar_status");
  await negativo(B, "B4 pedido__mudar_status ausente", db.b4mudar, [LB.mMudar]);
  db.b4estoque = await renomearPre(
    "b4estoque",
    SIG_ESTOQUE,
    "pv_devolver_estoque",
  );
  await negativo(B, "B4 devolver_estoque ausente", db.b4estoque, [LB.dEstoque]);
  db.b4dia = await renomearPre("b4dia", SIG_DIA, "pv_fin_dia");
  await negativo(B, "B4 fin__dia ausente", db.b4dia, [LB.dFin]);
  db.b4hoje = await renomearPre("b4hoje", SIG_HOJE, "pv_fin_hoje");
  await negativo(B, "B4 fin__hoje ausente", db.b4hoje, [LB.dFin]);
  // B5 tabela ausente (e, sem a tabela, as colunas dela também faltam)
  db.b5 = await novoPre(
    "b5",
    "ALTER TABLE public.devolucoes RENAME TO pv_devolucoes",
    "to_regclass('public.devolucoes') IS NULL",
  );
  await negativo(B, "B5 tabela devolucoes ausente", db.b5, [
    LB.tabelas,
    LB.colunas,
  ]);
  assert.equal(
    linha(await rodar(db.b5, B), LB.tabelas).vivo,
    "FALTA: devolucoes",
  );
  // B6 coluna ausente
  db.b6 = await novoPre(
    "b6",
    "ALTER TABLE public.marketplace_orders RENAME COLUMN estorno_manual_registrado_em TO pv_estorno_manual",
    `NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.marketplace_orders'::regclass AND attname = 'estorno_manual_registrado_em' AND NOT attisdropped)`,
  );
  await negativo(B, "B6 coluna estorno_manual_registrado_em ausente", db.b6, [
    LB.colunas,
  ]);
  assert.equal(
    linha(await rodar(db.b6, B), LB.colunas).vivo,
    "FALTA: marketplace_orders.estorno_manual_registrado_em",
  );
  ok(
    "11b reprova EXATAMENTE a linha que divergiu: a função já existe (árvore inteira, depois do apply, ou de outro corpo), corpo da is_admin_atual e da pedido__mudar_status com 1 byte a mais, cada dependência ausente, tabela ausente (e as colunas dela) e coluna ausente",
  );

  // ----------------------------------------------------------- MUTANTES
  const HASH_F = `'${HASH.fLF}'`;
  const m = (rotulo, consulta, trocas, banco, esperadas) =>
    mutanteTemQueSerPego(rotulo, consulta, trocas, banco, esperadas);
  await m(
    "A: hash do corpo ignorado",
    A,
    [["ELSE f.h END", `ELSE ${HASH_F} END`]],
    db.n7,
    [L.hash],
  );
  await m(
    "A: hash do corpo ignorado (um caractere trocado)",
    A,
    [["ELSE f.h END", `ELSE ${HASH_F} END`]],
    db.n7b,
    [L.hash],
  );
  await m(
    "A: SECURITY DEFINER ignorado",
    A,
    [
      [
        "COALESCE((SELECT f.prosecdef::text FROM fn f), 'AUSENTE')",
        "COALESCE((SELECT 'true' FROM fn f), 'AUSENTE')",
      ],
    ],
    db.n4,
    [L.def],
  );
  await m(
    "A: search_path ignorado",
    A,
    [
      [
        "COALESCE(array_to_string(f.proconfig, ','), 'sem search_path')",
        "'search_path=public'",
      ],
    ],
    db.n5,
    [L.sp],
  );
  await m(
    "A: search_path ignorado (com pg_temp)",
    A,
    [
      [
        "COALESCE(array_to_string(f.proconfig, ','), 'sem search_path')",
        "'search_path=public'",
      ],
    ],
    db.n5b,
    [L.sp],
  );
  await m(
    "A: linguagem e retorno ignorados",
    A,
    [
      [
        "COALESCE((SELECT f.lanname || ' ' || f.retorno FROM fn f), 'AUSENTE')",
        "COALESCE((SELECT 'plpgsql jsonb' FROM fn f), 'AUSENTE')",
      ],
    ],
    db.n6,
    [L.lang, L.hash],
  );
  await m(
    "A: EXECUTE para PUBLIC ignorado",
    A,
    [["CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END", "'nao'"]],
    db.n8pub,
    [L.pub, L.anon, L.service],
  );
  await m(
    "A: EXECUTE para anon ignorado",
    A,
    [
      [
        "has_function_privilege('anon', p.oid, 'EXECUTE') END AS exec_anon",
        "false END AS exec_anon",
      ],
    ],
    db.n8anon,
    [L.anon],
  );
  await m(
    "A: EXECUTE para service_role ignorado",
    A,
    [
      [
        "has_function_privilege('service_role', p.oid, 'EXECUTE') END AS exec_service",
        "false END AS exec_service",
      ],
    ],
    db.n8service,
    [L.service],
  );
  await m(
    "A: EXECUTE para authenticated ignorado",
    A,
    [
      [
        "has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS exec_auth",
        "true END AS exec_auth",
      ],
    ],
    db.n8auth,
    [L.auth],
  );
  await m(
    "A: sobrecarga extra ignorada",
    A,
    [
      [
        "AND p.proname = 'anular_venda_presencial')",
        "AND p.proname = 'anular_venda_presencial' AND p.pronargs = 2)",
      ],
    ],
    db.n2,
    [L.sobre],
  );
  await m(
    "A: dependência is_admin_atual ignorada",
    A,
    [
      [
        "CASE WHEN to_regprocedure('public.is_admin_atual()') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END",
        "'EXISTE'",
      ],
    ],
    db.n9admin,
    [L.dAdmin],
  );
  await m(
    "A: dependência pedido__mudar_status ignorada",
    A,
    [[`WHEN to_regprocedure('${SIG_MUDAR}') IS NOT NULL`, "WHEN true"]],
    db.n9mudar,
    [L.dMudar],
  );
  await m(
    "A: dependência devolver_estoque ignorada",
    A,
    [
      [
        "WHEN to_regprocedure('public.devolver_estoque(uuid)') IS NOT NULL",
        "WHEN true",
      ],
    ],
    db.n9estoque,
    [L.dEstoque],
  );
  await m(
    "A: dependência fin__hoje ignorada",
    A,
    [["AND to_regprocedure('public.fin__hoje()') IS NOT NULL", "AND true"]],
    db.n9hoje,
    [L.dFin],
  );
  await m(
    "B: função ausente ignorada",
    B,
    [
      [
        "AND p.proname = 'anular_venda_presencial')",
        "AND p.proname = 'anular_venda_presencial' AND false)",
      ],
    ],
    db.b1,
    [LB.ausente],
  );
  await m(
    "B: corpo da is_admin_atual ignorado",
    B,
    [
      [
        "WHERE p.oid = to_regprocedure('public.is_admin_atual()')), 'AUSENTE')",
        `WHERE false), '${MD5_ADMIN}')`,
      ],
    ],
    db.b2,
    [LB.mAdmin],
  );
  await m(
    "B: corpo da pedido__mudar_status ignorado",
    B,
    [
      [
        `WHERE p.oid = to_regprocedure('${SIG_MUDAR}')), 'AUSENTE')`,
        `WHERE false), '${MD5_MUDAR}')`,
      ],
    ],
    db.b3,
    [LB.mMudar],
  );
  await m(
    "B: devolver_estoque ignorado",
    B,
    [
      [
        "WHEN to_regprocedure('public.devolver_estoque(uuid)') IS NOT NULL",
        "WHEN true",
      ],
    ],
    db.b4estoque,
    [LB.dEstoque],
  );
  await m(
    "B: fin__hoje ignorado",
    B,
    [["AND to_regprocedure('public.fin__hoje()') IS NOT NULL", "AND true"]],
    db.b4hoje,
    [LB.dFin],
  );
  await m(
    "B: tabelas ignoradas",
    B,
    [
      [
        "WHEN (SELECT bool_and(t.oid IS NOT NULL) FROM tabelas t) THEN 'TODAS'",
        "WHEN true THEN 'TODAS'",
      ],
    ],
    db.b5,
    [LB.tabelas, LB.colunas],
  );
  await m(
    "B: colunas ignoradas",
    B,
    [
      [
        "WHEN (SELECT bool_and(c.existe) FROM colunas c) THEN 'TODAS'",
        "WHEN true THEN 'TODAS'",
      ],
    ],
    db.b6,
    [LB.colunas],
  );
  ok(
    "22 MUTANTES do texto das consultas (11a: hash do corpo [2], SECURITY DEFINER, search_path [2], linguagem, ACL de PUBLIC / anon / service_role / authenticated, sobrecarga, 4 dependências; 11b: função ausente, md5 das duas dependências, devolver_estoque, fin__hoje, tabelas, colunas) deixam o negativo correspondente PASSAR menos reprovado — a prova ficaria VERMELHA",
  );

  // ----------------------------------------------------------- ROL FECHADO
  {
    const rows = await rodar(pre, A);
    const parcial = rows.filter((r) => r.ok === true);
    assert.ok(parcial.length > 0 && parcial.length < rows.length);
    const v = veredito(A, parcial);
    assert.ok(v.endsWith("rol=invalido"), v);
    assert.equal(
      (await portaoComLog(A, v)).estado,
      "SEM_EVIDENCIA",
      "resposta PARCIAL com tudo ok=true nunca é positiva",
    );
    const dup = [...rowsCheio, rowsCheio[0]];
    assert.ok(veredito(A, dup).endsWith("rol=invalido"));
    assert.equal(
      (await portaoComLog(A, veredito(A, dup))).estado,
      "SEM_EVIDENCIA",
    );
    // o rol de uma consulta não vale para a outra
    const rowsB = await rodar(pre, B);
    assert.ok(veredito(A, rowsB).endsWith("rol=invalido"));
    assert.ok(veredito(B, rowsCheio).endsWith("rol=invalido"));
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
    assert.ok(lote, "o canais-de-backend.json real não declara o lote da 11a");
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
        linhas: 14,
        okFalse: 0,
        naoBooleano: 0,
        rol: "ok",
      });
      const e1b = await executar(pre, B);
      assert.deepEqual(PORTAO.lerVeredicto(e1b.saida, B), {
        ref: REF_SAVY,
        sha: SHA40,
        linhas: 8,
        okFalse: 0,
        naoBooleano: 0,
        rol: "ok",
      });
      // E2: banco inexistente → HTTP 400, saída 1, NENHUM veredito, SEM_EVIDENCIA
      const e2 = await executar("pv_banco_que_nao_existe", A);
      assert.equal(e2.codigo, 1, e2.saida);
      assert.ok(!e2.saida.includes("VEREDITO-CONSULTA"), e2.saida);
      assert.equal((await evidencia(A, e2.saida)).estado, "SEM_EVIDENCIA");

      // L1: loja ANTES do apply (ledger sem a versão): 11a NEGATIVA + 11b POSITIVA → APLICAR
      const l1 = await decidir(pre, { faltam: [VERSAO], exigeProva: true });
      assert.equal(l1.prova.estado, "NEGATIVA");
      assert.equal(l1.diag.estado, "POSITIVA");
      assert.equal(l1.decisao.acao, "APLICAR", JSON.stringify(l1.decisao));
      assert.deepEqual(l1.decisao.versoes, [VERSAO]);
      // L2: loja DEPOIS do apply, ledger com a versão: 11a POSITIVA → NADA
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
      // L4: ledger com a versão mas a função SECURITY INVOKER (11a e 11b negativas) → PARAR
      const l4 = await decidir(db.n4, { faltam: [], exigeProva: true });
      assert.equal(l4.prova.estado, "NEGATIVA");
      assert.equal(l4.decisao.acao, "PARAR", JSON.stringify(l4.decisao));
      // L5: ledger sem a versão, 11a NEGATIVA, mas a 11b NEGATIVA (corpo da is_admin_atual fora do pré-voo) → PARAR
      const l5 = await decidir(db.b2, { faltam: [VERSAO], exigeProva: true });
      assert.equal(l5.prova.estado, "NEGATIVA");
      assert.equal(l5.diag.estado, "NEGATIVA");
      assert.equal(l5.decisao.acao, "PARAR", JSON.stringify(l5.decisao));
      // L6: ledger sem a versão, função JÁ existe com outro corpo (11a e 11b negativas) → PARAR
      const l6 = await decidir(db.b1, { faltam: [VERSAO], exigeProva: true });
      assert.equal(l6.prova.estado, "NEGATIVA");
      assert.equal(l6.diag.estado, "NEGATIVA");
      assert.equal(l6.decisao.acao, "PARAR", JSON.stringify(l6.decisao));
      ok(
        "ponta a ponta (conferir-banco.cjs de verdade, HTTP local, papel de leitura, canais-de-backend.json REAL): ANTES do apply 11a NEGATIVA + 11b POSITIVA → APLICAR [20261204000000]; depois do apply 11a POSITIVA → NADA; objetos sem a versão no ledger → PARAR (sem backfill, sem apply); função SECURITY INVOKER → PARAR; 11b negativa (dependência com outro corpo, ou função já existente com outro corpo) → PARAR; banco inexistente → saída 1, sem veredito, SEM_EVIDENCIA",
      );
    } finally {
      await api.parar();
    }
  }

  console.log(`\n[anular-venda-portao-viva] ${resultados} provas ok`);
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
