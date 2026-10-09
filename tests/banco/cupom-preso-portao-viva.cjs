"use strict";

/**
 * Prova VIVA das duas consultas do PORTÃO DA RELEASE para as migrations
 * 20261205000000 e 20261206000000 (o cupom preso diz quando a vaga volta; a vaga do
 * pedido nunca cobrado volta em 1 h), num Postgres EFÊMERO local — nada de rede,
 * nada de loja:
 *   12a-conferir-cupom-preso-aplicado.sql              (DEPOIS do apply: 24 linhas)
 *   12b-antes-cupom-preso-funcoes-ausentes.sql         (ANTES do apply: 10 linhas)
 * Elas são a "prova de objetos" do lote 20261205000000 + 20261206000000 em
 * scripts/frota/canais-de-backend.json: sem elas o portão
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essas migrations
 * novas. Esta prova diz que cada consulta DECIDE certo — não que a CAF ou a Savy
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
 * O pg_cron do banco local é um STUB (tests/banco/provisionar.cjs) sem a coluna
 * `active` que o pg_cron real tem: as bases ganham a coluna (default true, como no
 * pg_cron real) antes de cada consulta — sem isso a consulta nem parseia aqui.
 *
 * BASES (montadas aqui, pelos mesmos scripts do rpc-ci.yml):
 *   cheio     a árvore inteira de migrations (com as duas);
 *   pre       a árvore SEM as duas (o estado de uma loja antes do apply);
 *   aplicado  `pre` + os DOIS ARQUIVOS aplicados de verdade, em ordem (LF);
 *   crlf      `pre` + os dois arquivos com fim de linha CRLF (checkout Windows);
 *   parcial   `pre` + SÓ a 20261205000000 (a 20261206000000 falhou ou não rodou).
 *
 * CASOS (cada um com a LINHA exata que reprova; o veredito real, com rol=ok e o
 * ok_false esperado, é conferido em TODO caso):
 *  POSITIVOS  12b em `pre`; 12a em `cheio`, em `aplicado` (IGUAL linha a linha ao
 *             `cheio`) e em `crlf`; as duas com o papel mínimo e com search_path
 *             trocado e objetos-isca de mesmo nome em outro schema; o dono da
 *             varredura OUTRO papel mas com EXECUTE no auxiliar (positivo: a linha
 *             mede o privilégio, não a igualdade de donos); o papel que sofre a RLS
 *             do pg_cron (row_security_active) e vê zero jobs: a linha do job diz
 *             NAO VERIFICAVEL e é ok; quem ATRAVESSA a RLS (BYPASSRLS) com zero jobs,
 *             ou a tabela sem RLS com zero jobs, REPROVA como AUSENTE.
 *  12a        auxiliar/RPC/varredura ausentes (cada um e ANTES do apply); sobrecarga
 *             extra de cada uma; só OUTRA assinatura; SECURITY INVOKER, sem
 *             search_path, search_path com pg_temp, linguagem sql, corpo com 1 byte a
 *             mais e com um caractere trocado; EXECUTE indevido (PUBLIC, anon,
 *             authenticated, service_role) e authenticated revogado na RPC; o dono da
 *             varredura ou da RPC sem EXECUTE no auxiliar; cada dependência ausente; job
 *             ausente, inativo ou fora do horario de 15 em 15 min.
 *  12b        auxiliar ou RPC já existem; varredura com 1 byte a mais, com um
 *             caractere trocado, com sobrecarga extra ou ausente; cada dependência
 *             ausente; tabela e coluna ausentes; job ausente, inativo ou fora do horario de 15 em 15 min.
 *  MUTANTES   cada linha da consulta ignorada e cada cláusula das linhas compostas
 *             (ACL do auxiliar, donos, job) desligada no texto do .sql deixa um
 *             negativo PASSAR e esta prova ficaria VERMELHA.
 *  FECHADO    resposta PARCIAL e linha duplicada têm rol=invalido: o portão NUNCA as
 *             trata como positivas.
 *  ERRO       SQL truncado (42601), papel sem USAGE no schema cron (42501) e banco
 *             inexistente: falha ALTA, nenhuma linha VEREDITO-CONSULTA, o portão fica
 *             SEM_EVIDENCIA mesmo com o run verde.
 *  PONTA A PONTA  conferir-banco.cjs de verdade (processo filho, HTTP local) e o
 *             LOTE do canais-de-backend.json REAL no `decidirLote`: ledger sem as
 *             versões + 12a NEGATIVA + 12b POSITIVA → APLICAR as duas, em ordem; 12a
 *             POSITIVA → PARAR (sem backfillLedger); ledger com as versões + 12a
 *             POSITIVA → NADA; só a primeira aplicada → PARAR.
 *
 * Toda mutação (de objeto, papel, tabela ou job) leva uma GUARDA que dá RAISE se não
 * aplicou: sem ela, um mutante que não aplica nada vira falso verde. Papéis
 * temporários com nome único, limpos no `finally`.
 *
 * LIMITES DECLARADOS: (1) o Postgres é o 17 LOCAL; o papel de leitura real da loja
 * (supabase_read_only_user), o Postgres 15/17 da Supabase, o pg_cron real e a ACL real
 * das lojas não foram medidos aqui. (2) A linha do job só é estrita quando o papel vê
 * algum job OU atravessa a RLS (row_security_active = false); um papel cego (a RLS do
 * pg_cron vale para ele e ele vê zero jobs) recebe NAO VERIFICAVEL e `ok`, e esta prova
 * afirma isso de propósito (um job inativo passa despercebido a um papel cego). (3) A
 * consulta não lê o comando do job: um job com o nome certo e outro comando não é
 * detectado.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/cupom-preso-portao-viva.cjs
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

const A = "12a-conferir-cupom-preso-aplicado";
const B = "12b-antes-cupom-preso-funcoes-ausentes";
const V1 = "20261205000000";
const V2 = "20261206000000";
const ARQ1 = "20261205000000_o_cupom_preso_diz_quando_a_vaga_volta.sql";
const ARQ2 =
  "20261206000000_a_vaga_do_cupom_nunca_cobrado_volta_em_uma_hora.sql";
const ARQ970 = "20260970000000_cancelamento_respeita_o_envio.sql";
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const SHA40 = "d".repeat(40);
const SQL = {
  [A]: fs.readFileSync(path.join(CONSULTAS, `${A}.sql`), "utf8"),
  [B]: fs.readFileSync(path.join(CONSULTAS, `${B}.sql`), "utf8"),
};
const ROL = { [A]: CONF.ROL_DA_12A, [B]: CONF.ROL_DA_12B };
const N_LINHAS = { [A]: 24, [B]: 10 };

const SIG_AUX =
  "public.cupom__vaga_volta_em(uuid,text,text,boolean,timestamptz,boolean,timestamptz,text,integer)";
const SIG_RPC = "public.vaga_do_cupom_presa(text)";
const SIG_VAR = "public.devolver_cupons_de_pedidos_mortos()";
const SIG_USO = "public.devolver_uso_cupom(uuid)";
const SIG_UID = "auth.uid()";
const JOB = "devolver-cupons-de-pedidos-mortos";

// Os hashes dos corpos são recalculados dos ARQUIVOS das migrations (nenhum literal
// solto aqui) e conferidos contra o que as consultas aceitam.
const lerLF = (arq) =>
  fs.readFileSync(path.join(MIGRATIONS, arq), "utf8").replace(/\r\n/g, "\n");
const corpoDe = (texto, cabecalho, tag) => {
  const ini = texto.indexOf(cabecalho);
  assert.ok(ini >= 0, `não achei ${cabecalho}`);
  const abre = texto.indexOf(`AS ${tag}`, ini) + `AS ${tag}`.length;
  return texto.slice(abre, texto.indexOf(`${tag};`, abre));
};
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const CORPOS = {
  aux: corpoDe(
    lerLF(ARQ2),
    "CREATE OR REPLACE FUNCTION public.cupom__vaga_volta_em(",
    "$function$",
  ),
  rpc: corpoDe(
    lerLF(ARQ1),
    "CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(",
    "$function$",
  ),
  var: corpoDe(
    lerLF(ARQ2),
    "CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()",
    "$devolver_cupons_mortos$",
  ),
  var970: corpoDe(
    lerLF(ARQ970),
    "CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()",
    "$devolver_cupons_mortos$",
  ),
};
const crlfDe = (s) => s.replace(/\n/g, "\r\n");
const HASH = Object.fromEntries(
  Object.entries(CORPOS).map(([k, v]) => [
    k,
    { lf: sha(v), crlf: sha(crlfDe(v)) },
  ]),
);
const HASH_DE = (sig) =>
  `(SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = to_regprocedure('${sig}'))`;

// Os nomes das linhas (o rol fechado do código tem os mesmos).
const AUX = "cupom__vaga_volta_em";
const RPC = "vaga_do_cupom_presa";
const VAR = "devolver_cupons_de_pedidos_mortos";
const CONTROLE = "controle: funcoes de public visiveis a este papel";
const L = {
  controle: CONTROLE,
  auxSobre: `${AUX}: sobrecargas`,
  auxHash: `${AUX}: corpo (sha256)`,
  auxAcl: `${AUX}: EXECUTE para PUBLIC, anon, authenticated e service_role`,
  rpcSobre: `${RPC}: sobrecargas`,
  rpcDef: `${RPC}: SECURITY DEFINER`,
  rpcSp: `${RPC}: search_path`,
  rpcLang: `${RPC}: linguagem e retorno`,
  rpcHash: `${RPC}: corpo (sha256)`,
  rpcPub: `${RPC}: EXECUTE para PUBLIC`,
  rpcAnon: `${RPC}: EXECUTE para anon`,
  rpcAuth: `${RPC}: EXECUTE para authenticated`,
  rpcService: `${RPC}: EXECUTE para service_role`,
  varSobre: `${VAR}: sobrecargas`,
  varDef: `${VAR}: SECURITY DEFINER`,
  varSp: `${VAR}: search_path`,
  varHash: `${VAR}: corpo (sha256)`,
  varPub: `${VAR}: EXECUTE para PUBLIC`,
  varAnon: `${VAR}: EXECUTE para anon`,
  varAuth: `${VAR}: EXECUTE para authenticated`,
  donos: "donos da varredura e da RPC: EXECUTE no auxiliar",
  depUso: "dependencia devolver_uso_cupom(uuid): existe",
  depUid: "dependencia auth.uid(): existe",
  job: `job ${JOB}: agendado a cada 15 min e ativo`,
};
const LB = {
  controle: CONTROLE,
  auxAus: `${AUX}: ausente`,
  rpcAus: `${RPC}: ausente`,
  varSobre: `${VAR}: sobrecargas`,
  varCorpo: `${VAR}: corpo e o da 20260970 (sha256)`,
  depUso: "dependencia devolver_uso_cupom(uuid): existe",
  depUid: "dependencia auth.uid(): existe",
  tabelas: "tabelas usadas: existem",
  colunas: "colunas usadas: existem",
  job: `job ${JOB}: agendado a cada 15 min e ativo`,
};
const AUX_TODAS = [L.auxSobre, L.auxHash, L.auxAcl];
const RPC_TODAS = [
  L.rpcSobre,
  L.rpcDef,
  L.rpcSp,
  L.rpcLang,
  L.rpcHash,
  L.rpcPub,
  L.rpcAnon,
  L.rpcAuth,
  L.rpcService,
];
const VAR_TODAS = [
  L.varSobre,
  L.varDef,
  L.varSp,
  L.varHash,
  L.varPub,
  L.varAnon,
  L.varAuth,
];
const NAO_VERIFICAVEL = "NAO VERIFICAVEL: este papel nao ve nenhum job do cron";

const ordena = (l) => [...l].sort();

const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const P = {
  ro: `pc_ro_${SUF}`, // LOGIN BYPASSRLS + pg_read_all_data: imita o supabase_read_only_user
  minimo: `pc_min_${SUF}`, // NOLOGIN, só o que a consulta precisa (USAGE em cron, SELECT em cron.job)
  cego: `pc_cego_${SUF}`, // pg_read_all_data SEM BYPASSRLS: a RLS do pg_cron o deixa sem job
  semcron: `pc_sc_${SUF}`, // NOLOGIN sem USAGE no schema cron
  dono: `pc_dono_${SUF}`, // dono alternativo das funções (sem EXECUTE no auxiliar)
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
  const nome = `pc_${SUF}_${clones.length}_${rotulo}`.slice(0, 60);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-"));
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
/** Aplica, num banco já existente, SÓ os arquivos pedidos (com o fim de linha pedido),
 * em ordem de nome, pelo mesmo script do rpc-ci.yml. */
function aplicarMigracoes(db, arquivos, { crlf = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-ap-"));
  try {
    for (const arq of arquivos) {
      let texto = fs.readFileSync(path.join(MIGRATIONS, arq), "utf8");
      texto = texto.replace(/\r\n/g, "\n");
      if (crlf) texto = texto.replace(/\n/g, "\r\n");
      fs.writeFileSync(path.join(dir, arq), texto);
    }
    rodarScriptNode([path.join(__dirname, "aplicar-migrations.cjs"), dir], {
      ...process.env,
      DATABASE_URL: urlDe(db),
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
/** O pg_cron do banco local é um stub sem `active`: ganha a coluna (default true, como o
 * pg_cron real) e os privilégios mínimos do papel mínimo (e o USAGE em auth do semcron). Vale para o banco e para os
 * clones que saírem dele. */
async function prepararCron(db) {
  await usar(db, async (c) => {
    await c.query(
      "ALTER TABLE cron.job ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true",
    );
    await c.query(`GRANT USAGE ON SCHEMA cron TO ${P.minimo}`);
    await c.query(`GRANT SELECT ON cron.job TO ${P.minimo}`);
    // auth.uid() e nomeada com schema: o papel precisa de USAGE em auth (o supabase_read_only_user
    // tem, via pg_read_all_data). O semcron so NAO tem o do cron: o erro dele e so do cron.
    await c.query(`GRANT USAGE ON SCHEMA auth TO ${P.minimo}, ${P.semcron}`);
  });
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
let relogio = Date.parse("2026-10-09T12:00:00Z");
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
 * booleano, `ok=false` primeiro, nenhuma coluna de pedido, cupom ou cliente. */
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
function aplicarTrocas(rotulo, consulta, trocas) {
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
  return sql;
}
/** Um MUTANTE do texto do .sql tem de ser PEGO: com ele, o negativo `db` deixa de
 * reprovar o que devia e `exigirReprovadas` LANÇA — a prova ficaria vermelha. */
async function mutanteTemQueSerPego(rotulo, consulta, trocas, db, esperadas) {
  const sql = aplicarTrocas(rotulo, consulta, trocas);
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
/** Mutante de um caso POSITIVO (papel cego): com o mutante a consulta deixa de dar
 * positiva e `exigirPositiva` LANÇA. */
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
    assert.ok(e instanceof assert.AssertionError, String(e));
  }
  assert.ok(pego, `${rotulo}: o MUTANTE do caso positivo passou despercebido`);
}
/** O texto da LINHA `item` da consulta: de `SELECT '<item>',` até o próximo
 * `UNION ALL`/comentário/fim da CTE. */
function textoDaLinha(consulta, item) {
  const sql = SQL[consulta];
  const ini = sql.indexOf(`SELECT '${item}',`);
  assert.ok(ini >= 0, `a linha "${item}" não existe na ${consulta}`);
  assert.equal(
    sql.indexOf(`SELECT '${item}',`, ini + 1),
    -1,
    `a linha "${item}" aparece mais de uma vez`,
  );
  const resto = sql.slice(ini);
  const fim = resto.search(/\n {2}(?:UNION ALL|-- )|\n\)\nSELECT item/);
  assert.ok(fim > 0, `não achei o fim da linha "${item}"`);
  return resto.slice(0, fim);
}
/** Mutante "a linha X da consulta sempre diz ok": o negativo que a reprovava passa. */
function mutanteDaLinha(rotulo, consulta, item, db, esperadas) {
  return mutanteTemQueSerPego(
    rotulo,
    consulta,
    [[textoDaLinha(consulta, item), `SELECT '${item}', 'x', 'x'`]],
    db,
    esperadas,
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
    ordena(CONF.ROL_DA_12A),
    ordena(Object.values(L)),
    "o rol da 12a do código é o conjunto de itens que esta prova conhece",
  );
  assert.deepEqual(
    ordena(CONF.ROL_DA_12B),
    ordena(Object.values(LB)),
    "o rol da 12b do código é o conjunto de itens que esta prova conhece",
  );

  // Os papéis são do CLUSTER; a prova os cria (nomes únicos) e os remove no finally.
  await usar("template1", async (a) => {
    await a.query(`CREATE ROLE ${P.ro} LOGIN BYPASSRLS`);
    await a.query(`ALTER ROLE ${P.ro} SET default_transaction_read_only = on`);
    await a.query(`CREATE ROLE ${P.minimo} NOLOGIN`);
    await a.query(`CREATE ROLE ${P.cego} NOLOGIN`);
    await a.query(`CREATE ROLE ${P.semcron} NOLOGIN`);
    await a.query(`CREATE ROLE ${P.dono} NOLOGIN`);
    await a.query(`GRANT pg_read_all_data TO ${P.ro}`);
    await a.query(`GRANT pg_read_all_data TO ${P.cego}`);
  });

  // ----------------------------------------------------------- precondição
  {
    const sonda = await usar(MOLDE, async (c) => ({
      funcoes: (
        await c.query(
          "SELECT to_regprocedure($1) IS NOT NULL AS a, to_regprocedure($2) IS NOT NULL AS r, to_regprocedure($3) IS NOT NULL AS v",
          [SIG_AUX, SIG_RPC, SIG_VAR],
        )
      ).rows[0],
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
      cronActive: (
        await c.query(
          "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'cron' AND table_name = 'job' AND column_name = 'active'",
        )
      ).rows[0].n,
    }));
    assert.deepEqual(
      sonda.funcoes,
      { a: true, r: true, v: true },
      "precondição: a árvore inteira tem as três funções",
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
    assert.equal(
      sonda.cronActive,
      0,
      "precondição: o stub do pg_cron local NÃO tem a coluna active (esta prova a acrescenta)",
    );
    // o que a 12a e a 12b aceitam é o que os ARQUIVOS das migrations definem
    for (const h of [HASH.aux, HASH.rpc, HASH.var])
      assert.ok(SQL[A].includes(`'${h.lf}'`) && SQL[A].includes(`'${h.crlf}'`));
    assert.ok(
      SQL[B].includes(`'${HASH.var970.lf}'`) &&
        SQL[B].includes(`'${HASH.var970.crlf}'`),
    );
    ok(
      "precondição: banco migrado com a árvore inteira (as três funções presentes), vazio, conexão superusuário, 3 papéis de fábrica, stub do pg_cron sem `active`; os sha256 (LF e CRLF) que a 12a e a 12b aceitam são os dos ARQUIVOS das migrations",
    );
  }

  // ----------------------------------------------------------- as bases
  const cheio = await clonar("cheio");
  await prepararCron(cheio);
  const pre = `pc_${SUF}_pre`.slice(0, 60);
  await montarBase(pre, (f) => f !== ARQ1 && f !== ARQ2);
  await prepararCron(pre);
  {
    const sonda = await usar(pre, async (c) => ({
      funcoes: (
        await c.query(
          "SELECT to_regprocedure($1) IS NOT NULL AS a, to_regprocedure($2) IS NOT NULL AS r",
          [SIG_AUX, SIG_RPC],
        )
      ).rows[0],
      varredura: (await c.query(`SELECT ${HASH_DE(SIG_VAR)} AS h`)).rows[0].h,
      job: (
        await c.query(
          "SELECT schedule, active FROM cron.job WHERE jobname = $1",
          [JOB],
        )
      ).rows,
    }));
    assert.deepEqual(sonda.funcoes, { a: false, r: false });
    assert.equal(
      sonda.varredura,
      HASH.var970.lf,
      "a base pre tem a varredura da 20260970 (LF)",
    );
    assert.deepEqual(sonda.job, [{ schedule: "*/15 * * * *", active: true }]);
  }
  const aplicado = await clonar("aplicado", pre);
  aplicarMigracoes(aplicado, [ARQ1, ARQ2]);
  const crlf = await clonar("crlf", pre);
  aplicarMigracoes(crlf, [ARQ1, ARQ2], { crlf: true });
  const parcial = await clonar("parcial", pre);
  aplicarMigracoes(parcial, [ARQ1]);
  ok(
    "bases montadas: cheio (árvore inteira), pre (sem as duas: sem as funções novas, varredura da 20260970, job */15 ativo), aplicado (pre + os DOIS ARQUIVOS aplicados em ordem, LF), crlf (idem, arquivos em CRLF) e parcial (pre + só a 20261205000000)",
  );

  // ----------------------------------------------------------- POSITIVOS
  const rowsCheio = await rodar(cheio, A);
  await exigirPositiva(A, "12a em cheio", rowsCheio);
  {
    const rowsAplicado = await rodar(aplicado, A);
    await exigirPositiva(A, "12a em aplicado", rowsAplicado);
    assert.deepEqual(
      rowsAplicado,
      rowsCheio,
      "o apply isolado dos ARQUIVOS sobre a base pré é indistinguível da árvore inteira",
    );
    assert.equal(linha(rowsAplicado, L.auxHash).vivo, HASH.aux.lf);
    assert.equal(linha(rowsAplicado, L.rpcHash).vivo, HASH.rpc.lf);
    assert.equal(linha(rowsAplicado, L.varHash).vivo, HASH.var.lf);
    assert.equal(linha(rowsAplicado, L.job).vivo, "ativo */15 * * * *");
    assert.equal(linha(rowsAplicado, L.auxAcl).vivo, "nenhum");
    assert.equal(linha(rowsAplicado, L.donos).vivo, "sim");
    const rowsCrlf = await rodar(crlf, A);
    await exigirPositiva(A, "12a em crlf", rowsCrlf);
    assert.equal(linha(rowsCrlf, L.auxHash).vivo, HASH.aux.lf);
    assert.equal(linha(rowsCrlf, L.rpcHash).vivo, HASH.rpc.lf);
    assert.equal(linha(rowsCrlf, L.varHash).vivo, HASH.var.lf);
    await usar(crlf, async (c) => {
      const h = (
        await c.query(
          `SELECT ${HASH_DE(SIG_AUX)} AS a, ${HASH_DE(SIG_RPC)} AS r, ${HASH_DE(SIG_VAR)} AS v`,
        )
      ).rows[0];
      assert.deepEqual(
        h,
        { a: HASH.aux.crlf, r: HASH.rpc.crlf, v: HASH.var.crlf },
        "guarda: os três corpos ficaram em CRLF no banco",
      );
    });
    ok(
      "12a POSITIVA (24 linhas, rol=ok, portão POSITIVA) na árvore inteira, nos ARQUIVOS aplicados sobre a base pré (resposta IDÊNTICA linha a linha) e nos arquivos em CRLF (corpos gravados em CRLF, hashes CRLF aceitos)",
    );
  }
  {
    const rows = await rodar(pre, B);
    await exigirPositiva(B, "12b em pre", rows);
    assert.equal(linha(rows, LB.varCorpo).vivo, HASH.var970.lf);
    assert.equal(linha(rows, LB.auxAus).vivo, "0");
    assert.equal(linha(rows, LB.rpcAus).vivo, "0");
    assert.equal(linha(rows, LB.job).vivo, "ativo */15 * * * *");
    ok(
      "12b POSITIVA (10 linhas, rol=ok, portão POSITIVA) na base SEM as migrations: auxiliar e RPC ausentes, varredura com o corpo da 20260970, dependências, tabelas, colunas e job */15 ativo",
    );
  }
  {
    // outro papel e outro search_path: as consultas só leem catálogo e nomeiam tudo
    // com schema; objetos-isca de mesmo nome em outro schema não mudam nada.
    const isca = `CREATE SCHEMA pc_isca;
       CREATE TABLE pc_isca.marketplace_orders (id int, status int);
       CREATE TABLE pc_isca.coupons (id int);
       CREATE FUNCTION pc_isca.cupom__vaga_volta_em(p int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
       CREATE FUNCTION pc_isca.vaga_do_cupom_presa(p text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
       CREATE FUNCTION pc_isca.devolver_cupons_de_pedidos_mortos() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
       CREATE FUNCTION pc_isca.devolver_uso_cupom(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
       GRANT USAGE ON SCHEMA pc_isca TO PUBLIC`;
    const iscas = await clonar("iscas", aplicado);
    await mutar(
      iscas,
      "schema de iscas",
      isca,
      "to_regclass('pc_isca.marketplace_orders') IS NOT NULL",
    );
    for (const [papel, antes, rotulo] of [
      [
        P.minimo,
        [],
        "papel mínimo (sem BYPASSRLS nem pg_read_all_data, só USAGE em cron e SELECT em cron.job)",
      ],
      [
        P.ro,
        ["SET search_path = pc_isca, pg_catalog"],
        "search_path com as iscas à frente",
      ],
      [P.ro, ["SET search_path = pg_catalog"], "search_path só pg_catalog"],
    ]) {
      await exigirPositiva(
        A,
        `12a ${rotulo}`,
        await rodar(iscas, A, { papel, antes }),
      );
    }
    await exigirPositiva(
      B,
      "12b papel mínimo",
      await rodar(pre, B, { papel: P.minimo }),
    );
    // no banco PRÉ com iscas à frente do search_path (a isca de mesmo nome NÃO pode
    // contar como "a função existe"), a 12b segue positiva
    const preIscas = await clonar("preiscas", pre);
    await mutar(
      preIscas,
      "iscas no pre",
      isca,
      "to_regclass('pc_isca.marketplace_orders') IS NOT NULL",
    );
    await exigirPositiva(
      B,
      "12b com iscas",
      await rodar(preIscas, B, {
        antes: ["SET search_path = pc_isca, pg_catalog"],
      }),
    );
    ok(
      "12a e 12b POSITIVAS também com o papel mínimo, com search_path trocado e com objetos-isca de mesmo nome em outro schema (tudo é nomeado com schema)",
    );
  }
  // O dono da varredura é OUTRO papel, mas com EXECUTE no auxiliar: a linha dos donos
  // mede o privilégio, não a igualdade dos donos.
  const donoComExecute = await clonar("donoexec", aplicado);
  await mutar(
    donoComExecute,
    "dono da varredura com EXECUTE no auxiliar",
    `GRANT CREATE ON SCHEMA public TO ${P.dono};
     GRANT EXECUTE ON FUNCTION ${SIG_AUX} TO ${P.dono};
     ALTER FUNCTION ${SIG_VAR} OWNER TO ${P.dono}`,
    `(SELECT pg_get_userbyid(proowner) = '${P.dono}' FROM pg_proc WHERE oid = to_regprocedure('${SIG_VAR}'))`,
  );
  await exigirPositiva(
    A,
    "12a com o dono da varredura em outro papel que TEM EXECUTE no auxiliar",
    await rodar(donoComExecute, A),
  );
  // O papel que não vê job nenhum (RLS do pg_cron): NAO VERIFICAVEL, e ok.
  const cego = await clonar("cego", aplicado);
  await mutar(
    cego,
    "RLS no cron.job",
    "ALTER TABLE cron.job ENABLE ROW LEVEL SECURITY",
    "(SELECT relrowsecurity FROM pg_class WHERE oid = 'cron.job'::regclass)",
  );
  const preCego = await clonar("precego", pre);
  await mutar(
    preCego,
    "RLS no cron.job (pre)",
    "ALTER TABLE cron.job ENABLE ROW LEVEL SECURITY",
    "(SELECT relrowsecurity FROM pg_class WHERE oid = 'cron.job'::regclass)",
  );
  {
    const rowsCego = await rodar(cego, A, { papel: P.cego });
    await exigirPositiva(A, "12a papel cego", rowsCego);
    assert.equal(linha(rowsCego, L.job).vivo, NAO_VERIFICAVEL);
    assert.equal(linha(rowsCego, L.job).esperado, NAO_VERIFICAVEL);
    const rowsPreCego = await rodar(preCego, B, { papel: P.cego });
    await exigirPositiva(B, "12b papel cego", rowsPreCego);
    assert.equal(linha(rowsPreCego, LB.job).vivo, NAO_VERIFICAVEL);
    // o MESMO banco, visto pelo papel de leitura que vê o job, é estrito
    assert.equal(linha(await rodar(cego, A), L.job).vivo, "ativo */15 * * * *");
    ok(
      "papel que não vê job nenhum (RLS do pg_cron, sem BYPASSRLS): a linha do job diz NAO VERIFICAVEL nas duas colunas e é ok — 12a e 12b POSITIVAS, nomeando o que não foi verificado; o mesmo banco visto pelo papel que vê o job mostra 'ativo */15 * * * *'",
    );
  }

  // ----------------------------------------------------------- 12a: NEGATIVOS
  const db = {};
  const novo = async (rotulo, sqlMut, guarda, de = cheio) => {
    const nome = await clonar(rotulo, de);
    await mutar(nome, rotulo, sqlMut, guarda);
    return nome;
  };
  const acl = (sig, quem) =>
    `EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = to_regprocedure('${sig}') AND a.grantee = ${quem})`;
  const exec = (papel, sig) =>
    `has_function_privilege('${papel}', to_regprocedure('${sig}'), 'EXECUTE')`;
  const nFuncoes = (nome) =>
    `(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${nome}')`;
  const ausente = (sig) => `to_regprocedure('${sig}') IS NULL`;

  // N1 cada função ausente: as linhas dela com AUSENTE, e os donos (a linha dos donos
  // precisa das três); as dependências e o job seguem provados
  db.n1aux = await novo("n1aux", `DROP FUNCTION ${SIG_AUX}`, ausente(SIG_AUX));
  await negativo(A, "N1 auxiliar ausente", db.n1aux, [...AUX_TODAS, L.donos]);
  db.n1rpc = await novo("n1rpc", `DROP FUNCTION ${SIG_RPC}`, ausente(SIG_RPC));
  await negativo(A, "N1 RPC ausente", db.n1rpc, [...RPC_TODAS, L.donos]);
  db.n1var = await novo("n1var", `DROP FUNCTION ${SIG_VAR}`, ausente(SIG_VAR));
  await negativo(A, "N1 varredura ausente", db.n1var, [...VAR_TODAS, L.donos]);
  {
    const r = await rodar(db.n1aux, A);
    assert.equal(linha(r, L.auxSobre).vivo, "0");
    assert.equal(linha(r, L.auxHash).vivo, "AUSENTE");
    assert.equal(linha(r, L.auxAcl).vivo, "AUSENTE");
    assert.equal(linha(r, L.donos).vivo, "AUSENTE");
    for (const k of ["depUso", "depUid", "job"])
      assert.equal(linha(r, L[k]).ok, true, `${k} continua provada`);
  }
  // 12a ANTES do apply: as duas funções novas ausentes, a varredura com o corpo velho
  await negativo(A, "N1b 12a ANTES do apply", pre, [
    ...AUX_TODAS,
    ...RPC_TODAS,
    L.varHash,
    L.donos,
  ]);
  assert.equal(
    linha(await rodar(pre, A), L.varHash).vivo,
    HASH.var970.lf,
    "antes do apply a varredura é a da 20260970",
  );
  // só a 1205 aplicada: o auxiliar e a RPC existem, mas o auxiliar é o v1 e a varredura a velha
  await negativo(A, "N1c 12a com só a 20261205 aplicada", parcial, [
    L.auxHash,
    L.varHash,
  ]);
  // N2 sobrecarga extra, de cada uma
  db.n2aux = await novo(
    "n2aux",
    "CREATE FUNCTION public.cupom__vaga_volta_em(p int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$",
    `${nFuncoes(AUX)} = 2`,
  );
  await negativo(A, "N2 sobrecarga extra do auxiliar", db.n2aux, [L.auxSobre]);
  db.n2rpc = await novo(
    "n2rpc",
    `CREATE FUNCTION public.vaga_do_cupom_presa(p int) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
    `${nFuncoes(RPC)} = 2`,
  );
  await negativo(A, "N2 sobrecarga extra da RPC", db.n2rpc, [L.rpcSobre]);
  db.n2var = await novo(
    "n2var",
    "CREATE FUNCTION public.devolver_cupons_de_pedidos_mortos(p int) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$",
    `${nFuncoes(VAR)} = 2`,
  );
  await negativo(A, "N2 sobrecarga extra da varredura", db.n2var, [L.varSobre]);
  // N3 só OUTRA assinatura (a de 2 argumentos some, fica uma de 1): a linha das
  // sobrecargas passa e a da função de verdade reprova em tudo
  db.n3rpc = await novo(
    "n3rpc",
    `DROP FUNCTION ${SIG_RPC};
     CREATE FUNCTION public.vaga_do_cupom_presa(p int) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
    `${ausente(SIG_RPC)} AND ${nFuncoes(RPC)} = 1`,
  );
  await negativo(
    A,
    "N3 só outra assinatura da RPC",
    db.n3rpc,
    RPC_TODAS.filter((x) => x !== L.rpcSobre).concat(L.donos),
  );
  ok(
    "12a reprova EXATAMENTE as linhas da função que divergiu: cada uma ausente (as linhas dela com AUSENTE, mais os donos; dependências e job seguem provados), ANTES do apply (auxiliar e RPC inteiros, o corpo velho da varredura, os donos), com só a 20261205 aplicada (auxiliar v1 e varredura velha), sobrecarga extra de cada uma e só outra assinatura da RPC — o portão dá NEGATIVA em todos",
  );

  // N4 SECURITY INVOKER / search_path / linguagem
  db.n4rpc = await novo(
    "n4rpc",
    `ALTER FUNCTION ${SIG_RPC} SECURITY INVOKER`,
    `(SELECT NOT prosecdef FROM pg_proc WHERE oid = to_regprocedure('${SIG_RPC}'))`,
  );
  await negativo(A, "N4 RPC SECURITY INVOKER", db.n4rpc, [L.rpcDef]);
  assert.equal(linha(await rodar(db.n4rpc, A), L.rpcDef).vivo, "false");
  db.n4var = await novo(
    "n4var",
    `ALTER FUNCTION ${SIG_VAR} SECURITY INVOKER`,
    `(SELECT NOT prosecdef FROM pg_proc WHERE oid = to_regprocedure('${SIG_VAR}'))`,
  );
  await negativo(A, "N4 varredura SECURITY INVOKER", db.n4var, [L.varDef]);
  db.n5rpc = await novo(
    "n5rpc",
    `ALTER FUNCTION ${SIG_RPC} RESET search_path`,
    `(SELECT proconfig IS NULL FROM pg_proc WHERE oid = to_regprocedure('${SIG_RPC}'))`,
  );
  await negativo(A, "N5 RPC sem search_path", db.n5rpc, [L.rpcSp]);
  assert.equal(
    linha(await rodar(db.n5rpc, A), L.rpcSp).vivo,
    "sem search_path",
  );
  db.n5rpcb = await novo(
    "n5rpcb",
    `ALTER FUNCTION ${SIG_RPC} SET search_path = public, pg_temp`,
    `(SELECT array_to_string(proconfig, ',') = 'search_path=public, pg_temp' FROM pg_proc WHERE oid = to_regprocedure('${SIG_RPC}'))`,
  );
  await negativo(A, "N5 RPC search_path com pg_temp", db.n5rpcb, [L.rpcSp]);
  db.n5var = await novo(
    "n5var",
    `ALTER FUNCTION ${SIG_VAR} RESET search_path`,
    `(SELECT proconfig IS NULL FROM pg_proc WHERE oid = to_regprocedure('${SIG_VAR}'))`,
  );
  await negativo(A, "N5 varredura sem search_path", db.n5var, [L.varSp]);
  db.n5varb = await novo(
    "n5varb",
    `ALTER FUNCTION ${SIG_VAR} SET search_path = public, pg_temp`,
    `(SELECT array_to_string(proconfig, ',') = 'search_path=public, pg_temp' FROM pg_proc WHERE oid = to_regprocedure('${SIG_VAR}'))`,
  );
  await negativo(A, "N5 varredura search_path com pg_temp", db.n5varb, [
    L.varSp,
  ]);
  db.n6rpc = await novo(
    "n6rpc",
    `CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(p_code text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT '{}'::jsonb $$`,
    `(SELECT l.lanname = 'sql' FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = to_regprocedure('${SIG_RPC}'))`,
  );
  await negativo(A, "N6 RPC em linguagem sql", db.n6rpc, [
    L.rpcLang,
    L.rpcHash,
  ]);
  assert.equal(linha(await rodar(db.n6rpc, A), L.rpcLang).vivo, "sql jsonb");
  // N7 corpo com 1 byte a mais / um caractere trocado
  const corpoMaisUmByte = async (rotulo, sig, chave) => {
    const nome = await novo(rotulo, "SELECT 1", "true");
    await reescreverCorpo(nome, sig, (c) => `${c} `);
    await mutar(
      nome,
      `${rotulo} corpo +1 byte`,
      "SELECT 1",
      `${HASH_DE(sig)} NOT IN ('${HASH[chave].lf}', '${HASH[chave].crlf}')`,
    );
    return nome;
  };
  const corpoTrocado = async (rotulo, sig, chave, de, para) => {
    const nome = await novo(rotulo, "SELECT 1", "true");
    await reescreverCorpo(nome, sig, (c) => {
      assert.ok(c.includes(de), `${rotulo}: o trecho ${de} não existe`);
      return c.replace(de, para);
    });
    await mutar(
      nome,
      `${rotulo} corpo trocado`,
      "SELECT 1",
      `${HASH_DE(sig)} NOT IN ('${HASH[chave].lf}', '${HASH[chave].crlf}')`,
    );
    return nome;
  };
  db.n7aux = await corpoMaisUmByte("n7aux", SIG_AUX, "aux");
  await negativo(A, "N7 auxiliar com 1 byte a mais", db.n7aux, [L.auxHash]);
  db.n7rpc = await corpoMaisUmByte("n7rpc", SIG_RPC, "rpc");
  await negativo(A, "N7 RPC com 1 byte a mais", db.n7rpc, [L.rpcHash]);
  db.n7var = await corpoMaisUmByte("n7var", SIG_VAR, "var");
  await negativo(A, "N7 varredura com 1 byte a mais", db.n7var, [L.varHash]);
  db.n7auxb = await corpoTrocado(
    "n7auxb",
    SIG_AUX,
    "aux",
    "24 hours",
    "25 hours",
  );
  await negativo(A, "N7 auxiliar com um caractere trocado", db.n7auxb, [
    L.auxHash,
  ]);
  db.n7rpcb = await corpoTrocado("n7rpcb", SIG_RPC, "rpc", "+ 15;", "+ 16;");
  await negativo(A, "N7 RPC com um caractere trocado", db.n7rpcb, [L.rpcHash]);
  db.n7varb = await corpoTrocado(
    "n7varb",
    SIG_VAR,
    "var",
    "coupon_usage_returned = TRUE",
    "coupon_usage_returned = true",
  );
  await negativo(A, "N7 varredura com um caractere trocado", db.n7varb, [
    L.varHash,
  ]);
  assert.notEqual(linha(await rodar(db.n7var, A), L.varHash).vivo, HASH.var.lf);
  ok(
    "12a reprova EXATAMENTE a linha que divergiu em cada função: SECURITY INVOKER (RPC e varredura), sem search_path e com pg_temp (as duas), linguagem sql na RPC, corpo com 1 byte a mais e com um caractere trocado (as três)",
  );

  // N8 ACL
  const acls = {
    auxPub: [
      "GRANT",
      SIG_AUX,
      "PUBLIC",
      acl(SIG_AUX, 0),
      [L.auxAcl],
      "PUBLIC,anon,authenticated,service_role",
    ],
    auxAnon: [
      "GRANT",
      SIG_AUX,
      "anon",
      exec("anon", SIG_AUX),
      [L.auxAcl],
      "anon",
    ],
    auxAuth: [
      "GRANT",
      SIG_AUX,
      "authenticated",
      exec("authenticated", SIG_AUX),
      [L.auxAcl],
      "authenticated",
    ],
    auxService: [
      "GRANT",
      SIG_AUX,
      "service_role",
      exec("service_role", SIG_AUX),
      [L.auxAcl],
      "service_role",
    ],
    rpcPub: [
      "GRANT",
      SIG_RPC,
      "PUBLIC",
      acl(SIG_RPC, 0),
      [L.rpcPub, L.rpcAnon, L.rpcService],
    ],
    rpcAnon: ["GRANT", SIG_RPC, "anon", exec("anon", SIG_RPC), [L.rpcAnon]],
    rpcService: [
      "GRANT",
      SIG_RPC,
      "service_role",
      exec("service_role", SIG_RPC),
      [L.rpcService],
    ],
    rpcAuth: [
      "REVOKE",
      SIG_RPC,
      "authenticated",
      `NOT ${exec("authenticated", SIG_RPC)}`,
      [L.rpcAuth],
    ],
    varPub: [
      "GRANT",
      SIG_VAR,
      "PUBLIC",
      acl(SIG_VAR, 0),
      [L.varPub, L.varAnon, L.varAuth],
    ],
    varAnon: ["GRANT", SIG_VAR, "anon", exec("anon", SIG_VAR), [L.varAnon]],
    varAuth: [
      "GRANT",
      SIG_VAR,
      "authenticated",
      exec("authenticated", SIG_VAR),
      [L.varAuth],
    ],
  };
  for (const [k, [verbo, sig, quem, guarda, esperadas, vivo]] of Object.entries(
    acls,
  )) {
    db[`n8${k}`] = await novo(
      `n8${k}`,
      `${verbo} EXECUTE ON FUNCTION ${sig} ${verbo === "GRANT" ? "TO" : "FROM"} ${quem}`,
      guarda,
    );
    const r = await negativo(
      A,
      `N8 ${k} (${verbo} ${quem})`,
      db[`n8${k}`],
      esperadas,
    );
    if (vivo)
      assert.equal(
        linha(r, esperadas[0]).vivo,
        vivo,
        `N8 ${k}: o que o vivo diz`,
      );
  }
  assert.equal(linha(await rodar(db.n8rpcAuth, A), L.rpcAuth).vivo, "nao");
  // service_role na varredura NÃO é medido (a 20260970 não o revoga): GRANT segue positivo
  {
    const sv = await novo(
      "n8varService",
      `GRANT EXECUTE ON FUNCTION ${SIG_VAR} TO service_role`,
      exec("service_role", SIG_VAR),
    );
    await exigirPositiva(
      A,
      "service_role na varredura (não medido, de propósito: a 20260970 não o revoga)",
      await rodar(sv, A),
    );
  }
  ok(
    "12a reprova EXATAMENTE a linha da ACL: auxiliar com EXECUTE para PUBLIC / anon / authenticated / service_role (uma linha só, que nomeia quem); RPC com PUBLIC (3 linhas, porque PUBLIC alcança anon e service_role), só anon, só service_role e authenticated revogado; varredura com PUBLIC (3 linhas), só anon e só authenticated — service_role na varredura segue positivo de propósito",
  );

  // N9 donos: o dono da varredura (ou da RPC) é outro papel SEM EXECUTE no auxiliar
  db.n9var = await novo(
    "n9var",
    `GRANT CREATE ON SCHEMA public TO ${P.dono};
     ALTER FUNCTION ${SIG_VAR} OWNER TO ${P.dono}`,
    `(SELECT pg_get_userbyid(proowner) = '${P.dono}' FROM pg_proc WHERE oid = to_regprocedure('${SIG_VAR}'))`,
  );
  {
    const r = await negativo(
      A,
      "N9 dono da varredura sem EXECUTE no auxiliar",
      db.n9var,
      [L.donos],
    );
    assert.equal(linha(r, L.donos).vivo, "nao");
  }
  db.n9rpc = await novo(
    "n9rpc",
    `GRANT CREATE ON SCHEMA public TO ${P.dono};
     ALTER FUNCTION ${SIG_RPC} OWNER TO ${P.dono}`,
    `(SELECT pg_get_userbyid(proowner) = '${P.dono}' FROM pg_proc WHERE oid = to_regprocedure('${SIG_RPC}'))`,
  );
  await negativo(A, "N9 dono da RPC sem EXECUTE no auxiliar", db.n9rpc, [
    L.donos,
  ]);
  // N10 dependências ausentes (renomeadas: sem arrastar quem as usa no catálogo)
  const renomear = async (rotulo, sql, guarda, de = cheio) =>
    novo(rotulo, sql, guarda, de);
  db.n10uso = await renomear(
    "n10uso",
    "ALTER FUNCTION public.devolver_uso_cupom(uuid) RENAME TO pc_devolver_uso_cupom",
    ausente(SIG_USO),
  );
  await negativo(A, "N10 devolver_uso_cupom ausente", db.n10uso, [L.depUso]);
  assert.equal(linha(await rodar(db.n10uso, A), L.depUso).vivo, "AUSENTE");
  db.n10uid = await renomear(
    "n10uid",
    "ALTER FUNCTION auth.uid() RENAME TO pc_uid",
    ausente(SIG_UID),
  );
  await negativo(A, "N10 auth.uid ausente", db.n10uid, [L.depUid]);
  ok(
    "12a reprova EXATAMENTE a linha dos donos quando o dono da varredura ou da RPC é outro papel sem EXECUTE no auxiliar (e o caso positivo, com EXECUTE concedido, passou acima), e a linha da dependência que sumiu: devolver_uso_cupom e auth.uid",
  );

  // N11 o job (a tabela cron.job tem a decoy `pc_isca_job` para o papel ver ALGUM job)
  const decoy = `INSERT INTO cron.job (jobname, schedule, command) VALUES ('pc_isca_job', '0 0 * * *', 'SELECT 1')`;
  db.n11aus = await novo(
    "n11aus",
    `${decoy}; DELETE FROM cron.job WHERE jobname = '${JOB}'`,
    `NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = '${JOB}') AND EXISTS (SELECT 1 FROM cron.job)`,
  );
  {
    const r = await negativo(A, "N11 job ausente", db.n11aus, [L.job]);
    assert.equal(linha(r, L.job).vivo, "AUSENTE");
  }
  db.n11ina = await novo(
    "n11ina",
    `UPDATE cron.job SET active = false WHERE jobname = '${JOB}'`,
    `(SELECT NOT active FROM cron.job WHERE jobname = '${JOB}')`,
  );
  {
    const r = await negativo(A, "N11 job inativo", db.n11ina, [L.job]);
    assert.equal(linha(r, L.job).vivo, "inativo */15 * * * *");
  }
  db.n11hor = await novo(
    "n11hor",
    `UPDATE cron.job SET schedule = '*/5 * * * *' WHERE jobname = '${JOB}'`,
    `(SELECT schedule = '*/5 * * * *' FROM cron.job WHERE jobname = '${JOB}')`,
  );
  {
    const r = await negativo(A, "N11 job fora de */15", db.n11hor, [L.job]);
    assert.equal(linha(r, L.job).vivo, "ativo */5 * * * *");
  }
  // o job inativo e o papel cego: a limitação declarada (NAO VERIFICAVEL passa)
  {
    const cegoInativo = await clonar("cegoina", db.n11ina);
    await mutar(
      cegoInativo,
      "RLS no cron.job (inativo)",
      "ALTER TABLE cron.job ENABLE ROW LEVEL SECURITY",
      "(SELECT relrowsecurity FROM pg_class WHERE oid = 'cron.job'::regclass)",
    );
    const rows = await rodar(cegoInativo, A, { papel: P.cego });
    await exigirPositiva(
      A,
      "papel cego com job inativo (limitação declarada)",
      rows,
    );
    assert.equal(linha(rows, L.job).vivo, NAO_VERIFICAVEL);
    ok(
      "12a reprova a linha do job quando ele está ausente, inativo ou fora de */15 (o vivo diz qual) — e, LIMITAÇÃO DECLARADA, o papel cego (RLS) recebe NAO VERIFICAVEL e ok mesmo com o job inativo: nesse caso o job se confere no painel",
    );
  }
  // R1 (revisão Opus): quem ATRAVESSA a RLS (BYPASSRLS, como o supabase_read_only_user) e
  // vê ZERO jobs NÃO é cego: o zero é a verdade. A linha só vira NAO VERIFICAVEL quando a
  // RLS está ATIVA para o papel (row_security_active('cron.job')) e ele vê zero jobs.
  const rlsLigadaSemJobs = (rotulo, de) =>
    novo(
      rotulo,
      "ALTER TABLE cron.job ENABLE ROW LEVEL SECURITY; DELETE FROM cron.job",
      "(SELECT relrowsecurity FROM pg_class WHERE oid = 'cron.job'::regclass) AND NOT EXISTS (SELECT 1 FROM cron.job)",
      de,
    );
  db.semJobs = await rlsLigadaSemJobs("semjobs", aplicado);
  db.semJobsB = await rlsLigadaSemJobs("semjobsb", pre);
  db.semRlsSemJobs = await novo(
    "semrlsjobs",
    "DELETE FROM cron.job",
    "NOT EXISTS (SELECT 1 FROM cron.job) AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'cron.job'::regclass)",
    aplicado,
  );
  {
    // a medição do revisor, refeita: BYPASSRLS => 'f'; RLS ativa => 't'
    const ativa = async (papel) =>
      usar(db.semJobs, async (c) => {
        await c.query(`SET ROLE ${papel}`);
        return (await c.query("SELECT row_security_active('cron.job') AS a"))
          .rows[0].a;
      });
    assert.equal(await ativa(P.ro), false, "BYPASSRLS atravessa a RLS");
    assert.equal(await ativa(P.cego), true, "o papel cego sofre a RLS");
    // (1) atravessa a RLS + zero jobs => ESTRITA: reprova (AUSENTE)
    const r1 = await negativo(A, "R1 BYPASSRLS + zero jobs (12a)", db.semJobs, [
      L.job,
    ]);
    assert.equal(linha(r1, L.job).vivo, "AUSENTE");
    const r1b = await negativo(
      B,
      "R1 BYPASSRLS + zero jobs (12b)",
      db.semJobsB,
      [LB.job],
    );
    assert.equal(linha(r1b, LB.job).vivo, "AUSENTE");
    // (2) RLS ativa + zero jobs visíveis => NAO VERIFICAVEL, ok (indistinguível de job existente)
    const r2 = await rodar(db.semJobs, A, { papel: P.cego });
    await exigirPositiva(A, "R1 papel cego + zero jobs (12a)", r2);
    assert.equal(linha(r2, L.job).vivo, NAO_VERIFICAVEL);
    const r2b = await rodar(db.semJobsB, B, { papel: P.cego });
    await exigirPositiva(B, "R1 papel cego + zero jobs (12b)", r2b);
    assert.equal(linha(r2b, LB.job).vivo, NAO_VERIFICAVEL);
    // (3) tabela SEM RLS + zero jobs, mesmo para o papel sem BYPASSRLS => ESTRITA: reprova
    for (const papel of [P.cego, P.ro]) {
      const r3 = await negativo(
        A,
        `R1 sem RLS + zero jobs (${papel === P.cego ? "sem BYPASSRLS" : "BYPASSRLS"})`,
        db.semRlsSemJobs,
        [L.job],
        { papel },
      );
      assert.equal(linha(r3, L.job).vivo, "AUSENTE");
    }
    // (4) o papel que VÊ o job ativo segue ok (os positivos acima: cheio/aplicado/crlf/papel mínimo)
    ok(
      "R1: a linha do job só vira NAO VERIFICAVEL quando a RLS do cron.job está ATIVA para o papel (row_security_active) E ele vê zero jobs; o papel que atravessa a RLS (BYPASSRLS) com zero jobs REPROVA como AUSENTE (12a e 12b), a tabela sem RLS com zero jobs também (com e sem BYPASSRLS), o papel cego com zero jobs recebe NAO VERIFICAVEL e ok, e o que vê o job ativo segue ok",
    );
  }
  // papel sem USAGE no schema cron: a consulta ERRA (nunca positivo)
  {
    const r = await tentar(aplicado, A, { papel: P.semcron });
    assert.ok(r.erro && r.erro.code === "42501", String(r.erro));
    assert.equal(r.rows, undefined);
    const rb = await tentar(pre, B, { papel: P.semcron });
    assert.ok(rb.erro && rb.erro.code === "42501", String(rb.erro));
    ok(
      "papel sem USAGE no schema cron: a 12a e a 12b ERRAM (42501) — falha alta, nunca uma resposta positiva",
    );
  }

  // ----------------------------------------------------------- 12b: NEGATIVOS
  const novoPre = (rotulo, sqlMut, guarda) => novo(rotulo, sqlMut, guarda, pre);
  // B1 as funções novas já existem
  await negativo(B, "B1 funções já existem (árvore inteira)", cheio, [
    LB.auxAus,
    LB.rpcAus,
    LB.varCorpo,
  ]);
  await negativo(B, "B1 funções já existem (depois do apply)", aplicado, [
    LB.auxAus,
    LB.rpcAus,
    LB.varCorpo,
  ]);
  await negativo(B, "B1 só a 20261205 aplicada", parcial, [
    LB.auxAus,
    LB.rpcAus,
  ]);
  db.b1aux = await novoPre(
    "b1aux",
    "CREATE FUNCTION public.cupom__vaga_volta_em(p int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$",
    `${nFuncoes(AUX)} = 1`,
  );
  await negativo(B, "B1 auxiliar de outra assinatura já existe", db.b1aux, [
    LB.auxAus,
  ]);
  assert.equal(linha(await rodar(db.b1aux, B), LB.auxAus).vivo, "1");
  db.b1rpc = await novoPre(
    "b1rpc",
    `CREATE FUNCTION public.vaga_do_cupom_presa(p_code text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
    `${nFuncoes(RPC)} = 1`,
  );
  await negativo(B, "B1 RPC de outro corpo já existe", db.b1rpc, [LB.rpcAus]);
  // B2 a varredura: corpo com 1 byte a mais / um caractere trocado / sobrecarga / ausente
  db.b2 = await novoPre("b2", "SELECT 1", "true");
  await reescreverCorpo(db.b2, SIG_VAR, (c) => `${c} `);
  await mutar(
    db.b2,
    "b2 varredura +1 byte",
    "SELECT 1",
    `${HASH_DE(SIG_VAR)} NOT IN ('${HASH.var970.lf}', '${HASH.var970.crlf}')`,
  );
  await negativo(B, "B2 varredura com 1 byte a mais", db.b2, [LB.varCorpo]);
  db.b2b = await novoPre("b2b", "SELECT 1", "true");
  await reescreverCorpo(db.b2b, SIG_VAR, (c) => {
    assert.ok(c.includes("coupon_usage_returned = TRUE"));
    return c.replace(
      "coupon_usage_returned = TRUE",
      "coupon_usage_returned = true",
    );
  });
  await mutar(
    db.b2b,
    "b2b varredura trocada",
    "SELECT 1",
    `${HASH_DE(SIG_VAR)} NOT IN ('${HASH.var970.lf}', '${HASH.var970.crlf}')`,
  );
  await negativo(B, "B2 varredura com um caractere trocado", db.b2b, [
    LB.varCorpo,
  ]);
  db.b3 = await novoPre(
    "b3",
    "CREATE FUNCTION public.devolver_cupons_de_pedidos_mortos(p int) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$",
    `${nFuncoes(VAR)} = 2`,
  );
  await negativo(B, "B3 sobrecarga extra da varredura", db.b3, [LB.varSobre]);
  db.b3b = await novoPre("b3b", `DROP FUNCTION ${SIG_VAR}`, ausente(SIG_VAR));
  await negativo(B, "B3 varredura ausente", db.b3b, [LB.varSobre, LB.varCorpo]);
  assert.equal(linha(await rodar(db.b3b, B), LB.varCorpo).vivo, "AUSENTE");
  // B4 dependências ausentes
  db.b4uso = await novoPre(
    "b4uso",
    "ALTER FUNCTION public.devolver_uso_cupom(uuid) RENAME TO pc_devolver_uso_cupom",
    ausente(SIG_USO),
  );
  await negativo(B, "B4 devolver_uso_cupom ausente", db.b4uso, [LB.depUso]);
  db.b4uid = await novoPre(
    "b4uid",
    "ALTER FUNCTION auth.uid() RENAME TO pc_uid",
    ausente(SIG_UID),
  );
  await negativo(B, "B4 auth.uid ausente", db.b4uid, [LB.depUid]);
  // B5 tabela ausente (e, sem a tabela, as colunas dela também faltam)
  db.b5 = await novoPre(
    "b5",
    "ALTER TABLE public.coupons RENAME TO pc_coupons",
    "to_regclass('public.coupons') IS NULL",
  );
  await negativo(B, "B5 tabela coupons ausente", db.b5, [
    LB.tabelas,
    LB.colunas,
  ]);
  assert.equal(linha(await rodar(db.b5, B), LB.tabelas).vivo, "FALTA: coupons");
  // B6 coluna ausente
  db.b6 = await novoPre(
    "b6",
    "ALTER TABLE public.marketplace_orders RENAME COLUMN tentativas_de_pagamento TO pc_tentativas",
    `NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.marketplace_orders'::regclass AND attname = 'tentativas_de_pagamento' AND NOT attisdropped)`,
  );
  await negativo(B, "B6 coluna tentativas_de_pagamento ausente", db.b6, [
    LB.colunas,
  ]);
  assert.equal(
    linha(await rodar(db.b6, B), LB.colunas).vivo,
    "FALTA: marketplace_orders.tentativas_de_pagamento",
  );
  db.b6b = await novoPre(
    "b6b",
    "ALTER TABLE public.coupons RENAME COLUMN usage_limit TO pc_limite",
    `NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.coupons'::regclass AND attname = 'usage_limit' AND NOT attisdropped)`,
  );
  await negativo(B, "B6 coluna coupons.usage_limit ausente", db.b6b, [
    LB.colunas,
  ]);
  // B7 o job
  db.b7aus = await novoPre(
    "b7aus",
    `${decoy}; DELETE FROM cron.job WHERE jobname = '${JOB}'`,
    `NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = '${JOB}') AND EXISTS (SELECT 1 FROM cron.job)`,
  );
  await negativo(B, "B7 job ausente", db.b7aus, [LB.job]);
  db.b7ina = await novoPre(
    "b7ina",
    `UPDATE cron.job SET active = false WHERE jobname = '${JOB}'`,
    `(SELECT NOT active FROM cron.job WHERE jobname = '${JOB}')`,
  );
  await negativo(B, "B7 job inativo", db.b7ina, [LB.job]);
  db.b7hor = await novoPre(
    "b7hor",
    `UPDATE cron.job SET schedule = '*/5 * * * *' WHERE jobname = '${JOB}'`,
    `(SELECT schedule = '*/5 * * * *' FROM cron.job WHERE jobname = '${JOB}')`,
  );
  await negativo(B, "B7 job fora de */15", db.b7hor, [LB.job]);
  ok(
    "12b reprova EXATAMENTE a linha que divergiu: as funções novas já existem (árvore inteira, depois do apply, só a 20261205, ou de outra assinatura/corpo), varredura com 1 byte a mais, com um caractere trocado, com sobrecarga extra ou ausente, cada dependência ausente, tabela ausente (e as colunas dela), coluna ausente e job ausente, inativo ou fora de */15",
  );

  // ----------------------------------------------------------- MUTANTES
  const m = mutanteTemQueSerPego;
  const ml = mutanteDaLinha;
  // 12a: cada linha ignorada, contra o negativo que a reprovava
  await ml("A: auxiliar sobrecargas ignorada", A, L.auxSobre, db.n2aux, [
    L.auxSobre,
  ]);
  await ml("A: auxiliar corpo ignorado", A, L.auxHash, db.n7aux, [L.auxHash]);
  await ml(
    "A: auxiliar corpo ignorado (caractere trocado)",
    A,
    L.auxHash,
    db.n7auxb,
    [L.auxHash],
  );
  await ml("A: auxiliar ACL ignorada", A, L.auxAcl, db.n8auxPub, [L.auxAcl]);
  await ml("A: RPC sobrecargas ignorada", A, L.rpcSobre, db.n2rpc, [
    L.rpcSobre,
  ]);
  await ml("A: RPC SECURITY DEFINER ignorado", A, L.rpcDef, db.n4rpc, [
    L.rpcDef,
  ]);
  await ml("A: RPC search_path ignorado", A, L.rpcSp, db.n5rpc, [L.rpcSp]);
  await ml("A: RPC search_path ignorado (pg_temp)", A, L.rpcSp, db.n5rpcb, [
    L.rpcSp,
  ]);
  await ml("A: RPC linguagem ignorada", A, L.rpcLang, db.n6rpc, [
    L.rpcLang,
    L.rpcHash,
  ]);
  await ml("A: RPC corpo ignorado", A, L.rpcHash, db.n7rpc, [L.rpcHash]);
  await ml(
    "A: RPC corpo ignorado (caractere trocado)",
    A,
    L.rpcHash,
    db.n7rpcb,
    [L.rpcHash],
  );
  await ml("A: RPC EXECUTE PUBLIC ignorado", A, L.rpcPub, db.n8rpcPub, [
    L.rpcPub,
    L.rpcAnon,
    L.rpcService,
  ]);
  await ml("A: RPC EXECUTE anon ignorado", A, L.rpcAnon, db.n8rpcAnon, [
    L.rpcAnon,
  ]);
  await ml(
    "A: RPC EXECUTE authenticated ignorado",
    A,
    L.rpcAuth,
    db.n8rpcAuth,
    [L.rpcAuth],
  );
  await ml(
    "A: RPC EXECUTE service_role ignorado",
    A,
    L.rpcService,
    db.n8rpcService,
    [L.rpcService],
  );
  await ml("A: varredura sobrecargas ignorada", A, L.varSobre, db.n2var, [
    L.varSobre,
  ]);
  await ml("A: varredura SECURITY DEFINER ignorado", A, L.varDef, db.n4var, [
    L.varDef,
  ]);
  await ml("A: varredura search_path ignorado", A, L.varSp, db.n5var, [
    L.varSp,
  ]);
  await ml(
    "A: varredura search_path ignorado (pg_temp)",
    A,
    L.varSp,
    db.n5varb,
    [L.varSp],
  );
  await ml("A: varredura corpo ignorado", A, L.varHash, db.n7var, [L.varHash]);
  await ml(
    "A: varredura corpo ignorado (caractere trocado)",
    A,
    L.varHash,
    db.n7varb,
    [L.varHash],
  );
  await ml("A: varredura EXECUTE PUBLIC ignorado", A, L.varPub, db.n8varPub, [
    L.varPub,
    L.varAnon,
    L.varAuth,
  ]);
  await ml("A: varredura EXECUTE anon ignorado", A, L.varAnon, db.n8varAnon, [
    L.varAnon,
  ]);
  await ml(
    "A: varredura EXECUTE authenticated ignorado",
    A,
    L.varAuth,
    db.n8varAuth,
    [L.varAuth],
  );
  await ml("A: donos ignorado (varredura)", A, L.donos, db.n9var, [L.donos]);
  await ml(
    "A: dependência devolver_uso_cupom ignorada",
    A,
    L.depUso,
    db.n10uso,
    [L.depUso],
  );
  await ml("A: dependência auth.uid ignorada", A, L.depUid, db.n10uid, [
    L.depUid,
  ]);
  await ml("A: job ignorado (inativo)", A, L.job, db.n11ina, [L.job]);
  // 12a: cláusulas das linhas compostas
  const elementoAcl = (papel, expr) => [
    `CASE WHEN ${expr} THEN '${papel}' END`,
    "NULL",
  ];
  // O elemento PUBLIC da ACL do auxiliar NAO tem mutante: PUBLIC alcanca anon, authenticated e
  // service_role, que ja reprovam a mesma linha (tirar so o PUBLIC seria um mutante equivalente).
  await m(
    "A: ACL do auxiliar: anon ignorado",
    A,
    [elementoAcl("anon", "COALESCE(f.exec_anon, false)")],
    db.n8auxAnon,
    [L.auxAcl],
  );
  await m(
    "A: ACL do auxiliar: authenticated ignorado",
    A,
    [elementoAcl("authenticated", "COALESCE(f.exec_auth, false)")],
    db.n8auxAuth,
    [L.auxAcl],
  );
  await m(
    "A: ACL do auxiliar: service_role ignorado",
    A,
    [elementoAcl("service_role", "COALESCE(f.exec_service, false)")],
    db.n8auxService,
    [L.auxAcl],
  );
  await m(
    "A: donos: só o dono da varredura conta (o da RPC ignorado)",
    A,
    [["d.chave IN ('rpc', 'var')", "d.chave IN ('var')"]],
    db.n9rpc,
    [L.donos],
  );
  await m(
    "A: donos: só o dono da RPC conta (o da varredura ignorado)",
    A,
    [["d.chave IN ('rpc', 'var')", "d.chave IN ('rpc')"]],
    db.n9var,
    [L.donos],
  );
  await m(
    "A: donos: a ausência de função ignorada (RPC ausente: só o dono da varredura seria medido e a linha daria sim)",
    A,
    [
      [
        "WHEN (SELECT count(*) FROM f) <> 3 THEN 'AUSENTE'",
        "WHEN false THEN 'AUSENTE'",
      ],
    ],
    db.n1rpc,
    [...RPC_TODAS, L.donos],
  );
  await m(
    "A: job: o campo active ignorado",
    A,
    [["CASE WHEN g.active THEN 'ativo ' ELSE 'inativo ' END", "'ativo '"]],
    db.n11ina,
    [L.job],
  );
  await m(
    "A: job: o horário ignorado",
    A,
    [["|| g.schedule,", "|| '*/15 * * * *',"]],
    db.n11hor,
    [L.job],
  );
  const SEM_RLS = " AND (SELECT ativa FROM rls)";
  await m(
    "A: job: row_security_active ignorado (zero jobs visíveis vira NAO VERIFICAVEL para quem atravessa a RLS)",
    A,
    [
      [SEM_RLS, ""],
      [SEM_RLS, ""],
    ],
    db.semJobs,
    [L.job],
  );
  await m(
    "A: job: row_security_active ignorado (tabela sem RLS)",
    A,
    [
      [SEM_RLS, ""],
      [SEM_RLS, ""],
    ],
    db.semRlsSemJobs,
    [L.job],
  );
  await m(
    "B: job: row_security_active ignorado (zero jobs visíveis vira NAO VERIFICAVEL para quem atravessa a RLS)",
    B,
    [
      [SEM_RLS, ""],
      [SEM_RLS, ""],
    ],
    db.semJobsB,
    [LB.job],
  );
  await mutantePositivoTemQueSerPego(
    "A: job: a guarda do papel cego (sempre estrito)",
    A,
    [
      [
        "WHEN (SELECT n FROM vis) = 0 AND (SELECT ativa FROM rls)\n              THEN 'NAO VERIFICAVEL: este papel nao ve nenhum job do cron'\n              WHEN NOT EXISTS",
        "WHEN false\n              THEN 'NAO VERIFICAVEL: este papel nao ve nenhum job do cron'\n              WHEN NOT EXISTS",
      ],
    ],
    cego,
    { papel: P.cego },
  );
  // 12b: cada linha ignorada
  await ml("B: auxiliar ausente ignorado", B, LB.auxAus, db.b1aux, [LB.auxAus]);
  await ml("B: RPC ausente ignorada", B, LB.rpcAus, db.b1rpc, [LB.rpcAus]);
  await ml("B: varredura sobrecargas ignorada", B, LB.varSobre, db.b3, [
    LB.varSobre,
  ]);
  await ml("B: varredura corpo ignorado", B, LB.varCorpo, db.b2, [LB.varCorpo]);
  await ml(
    "B: varredura corpo ignorado (caractere trocado)",
    B,
    LB.varCorpo,
    db.b2b,
    [LB.varCorpo],
  );
  await ml(
    "B: dependência devolver_uso_cupom ignorada",
    B,
    LB.depUso,
    db.b4uso,
    [LB.depUso],
  );
  await ml("B: dependência auth.uid ignorada", B, LB.depUid, db.b4uid, [
    LB.depUid,
  ]);
  await ml("B: tabelas ignoradas", B, LB.tabelas, db.b5, [
    LB.tabelas,
    LB.colunas,
  ]);
  await ml("B: colunas ignoradas", B, LB.colunas, db.b6, [LB.colunas]);
  await ml("B: job ignorado (inativo)", B, LB.job, db.b7ina, [LB.job]);
  await m(
    "B: job: o campo active ignorado",
    B,
    [["CASE WHEN g.active THEN 'ativo ' ELSE 'inativo ' END", "'ativo '"]],
    db.b7ina,
    [LB.job],
  );
  await m(
    "B: job: o horário ignorado",
    B,
    [["|| g.schedule,", "|| '*/15 * * * *',"]],
    db.b7hor,
    [LB.job],
  );
  ok(
    "MUTANTES do texto das consultas: 12a com cada uma das 24 linhas ignoradas (sobrecargas, corpo [2 formas], ACL, SECURITY DEFINER, search_path [2], linguagem, dependências, donos, job) e as cláusulas das linhas compostas (anon/authenticated/service_role do auxiliar — PUBLIC não tem mutante próprio, seria equivalente, porque PUBLIC alcança os três —, cada dono, a ausência, active e horário do job, a guarda do papel cego); 12b com cada linha ignorada e active/horário do job — todos deixam o negativo PASSAR menos reprovado e a prova ficaria VERMELHA",
  );

  // ----------------------------------------------------------- ROL FECHADO
  {
    const rows = await rodar(pre, A);
    const parcialRows = rows.filter((r) => r.ok === true);
    assert.ok(parcialRows.length > 0 && parcialRows.length < rows.length);
    const v = veredito(A, parcialRows);
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
    assert.ok(lote, "o canais-de-backend.json real não declara o lote da 12a");
    assert.deepEqual(lote.versoes, [V1, V2]);
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
          lote: { ...lote, versoes: [V1, V2] },
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
        linhas: 24,
        okFalse: 0,
        naoBooleano: 0,
        rol: "ok",
      });
      const e1b = await executar(pre, B);
      assert.deepEqual(PORTAO.lerVeredicto(e1b.saida, B), {
        ref: REF_SAVY,
        sha: SHA40,
        linhas: 10,
        okFalse: 0,
        naoBooleano: 0,
        rol: "ok",
      });
      // E2: banco inexistente → HTTP 400, saída 1, NENHUM veredito, SEM_EVIDENCIA
      const e2 = await executar("pc_banco_que_nao_existe", A);
      assert.equal(e2.codigo, 1, e2.saida);
      assert.ok(!e2.saida.includes("VEREDITO-CONSULTA"), e2.saida);
      assert.equal((await evidencia(A, e2.saida)).estado, "SEM_EVIDENCIA");
      // E3: papel sem USAGE no schema cron → erro do banco, saída 1, NENHUM veredito
      const e3 = await executar(aplicado, A, P.semcron);
      assert.equal(e3.codigo, 1, e3.saida);
      assert.ok(!e3.saida.includes("VEREDITO-CONSULTA"), e3.saida);
      assert.equal((await evidencia(A, e3.saida)).estado, "SEM_EVIDENCIA");

      // L1: loja ANTES do apply (ledger sem as versões): 12a NEGATIVA + 12b POSITIVA → APLICAR as duas
      const l1 = await decidir(pre, { faltam: [V1, V2], exigeProva: true });
      assert.equal(l1.prova.estado, "NEGATIVA");
      assert.equal(l1.diag.estado, "POSITIVA");
      assert.equal(l1.decisao.acao, "APLICAR", JSON.stringify(l1.decisao));
      assert.deepEqual(l1.decisao.versoes, [V1, V2]);
      // L2: loja DEPOIS do apply, ledger com as versões: 12a POSITIVA → NADA
      const l2 = await decidir(aplicado, { faltam: [], exigeProva: true });
      assert.equal(l2.prova.estado, "POSITIVA");
      assert.equal(l2.decisao.acao, "NADA", JSON.stringify(l2.decisao));
      // L3: objetos no banco mas o ledger SEM as versões e sem backfillLedger → PARAR, nenhum apply
      const l3 = await decidir(aplicado, {
        faltam: [V1, V2],
        exigeProva: true,
      });
      assert.equal(l3.prova.estado, "POSITIVA");
      assert.equal(l3.decisao.acao, "PARAR", JSON.stringify(l3.decisao));
      assert.match(l3.decisao.motivo, /não declara backfillLedger/);
      // L4: ledger com as versões mas a varredura SECURITY INVOKER (12a e 12b negativas) → PARAR
      const l4 = await decidir(db.n4var, { faltam: [], exigeProva: true });
      assert.equal(l4.prova.estado, "NEGATIVA");
      assert.equal(l4.decisao.acao, "PARAR", JSON.stringify(l4.decisao));
      // L5: só a 20261205 aplicada (a 20261206 falhou): ledger sem a segunda, 12a e 12b negativas → PARAR
      const l5 = await decidir(parcial, { faltam: [V2], exigeProva: true });
      assert.equal(l5.prova.estado, "NEGATIVA");
      assert.equal(l5.diag.estado, "NEGATIVA");
      assert.equal(l5.decisao.acao, "PARAR", JSON.stringify(l5.decisao));
      // L6: ledger sem as versões, 12a NEGATIVA, mas a 12b NEGATIVA (a varredura com outro corpo) → PARAR
      const l6 = await decidir(db.b2, { faltam: [V1, V2], exigeProva: true });
      assert.equal(l6.prova.estado, "NEGATIVA");
      assert.equal(l6.diag.estado, "NEGATIVA");
      assert.equal(l6.decisao.acao, "PARAR", JSON.stringify(l6.decisao));
      // L7: ledger sem as versões, as funções novas JÁ existem com outro corpo (12a e 12b negativas) → PARAR
      const l7 = await decidir(db.b1rpc, {
        faltam: [V1, V2],
        exigeProva: true,
      });
      assert.equal(l7.prova.estado, "NEGATIVA");
      assert.equal(l7.diag.estado, "NEGATIVA");
      assert.equal(l7.decisao.acao, "PARAR", JSON.stringify(l7.decisao));
      ok(
        "ponta a ponta (conferir-banco.cjs de verdade, HTTP local, papel de leitura, canais-de-backend.json REAL): ANTES do apply 12a NEGATIVA + 12b POSITIVA → APLICAR [20261205000000, 20261206000000] em ordem; depois do apply 12a POSITIVA → NADA; objetos sem as versões no ledger → PARAR (sem backfill, sem apply); varredura SECURITY INVOKER → PARAR; só a 20261205 aplicada → PARAR; 12b negativa (varredura de outro corpo, ou funções novas já existentes com outro corpo) → PARAR; banco inexistente e papel sem USAGE em cron → saída 1, sem veredito, SEM_EVIDENCIA",
      );
    } finally {
      await api.parar();
    }
  }

  console.log(`\n[cupom-preso-portao-viva] ${resultados} provas ok`);
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
