"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para as migrations 20261209000000 (a foto
 * da cobranca no cancelamento) e 20261210000000 (a vaga do cupom do PIX anulado volta em
 * minutos), num Postgres EFEMERO local -- nada de rede, nada de loja:
 *   16a-conferir-pix-anulado-aplicado.sql          (DEPOIS do apply: 32 linhas)
 *   16b-antes-pix-anulado-foto-ausente.sql         (ANTES do apply: 14 linhas)
 * Elas sao a "prova de objetos" do lote 20261209000000 + 20261210000000 em
 * scripts/frota/canais-de-backend.json: sem elas o portao (scripts/frota/publicar-release.mjs)
 * bloqueia a release com essas migrations novas. Esta prova diz que cada consulta DECIDE certo --
 * nao que a IKCOUS ou a Savy estao no estado A ou B (isso so o run da consulta contra o ref de
 * cada loja diz).
 *
 * COMO RODA: cada defeito num banco CLONADO (`CREATE DATABASE ... TEMPLATE`) que some no fim; a
 * consulta sempre como papel de LEITURA nao superusuario (LOGIN BYPASSRLS + pg_read_all_data,
 * read-only por padrao, imitando o supabase_read_only_user). Cada veredito e' levado ate o
 * PORTAO de verdade (`evidenciaDaProva` e `decidirLote`): "positiva" aqui quer dizer POSITIVA
 * para o portao, com `rol=ok`; "reprova" quer dizer NEGATIVA (nunca POSITIVA).
 *
 * O pg_cron do banco local e' um STUB (tests/banco/provisionar.cjs) sem a coluna `active` que o
 * pg_cron real tem: as bases ganham a coluna (default true, como no pg_cron real) antes de cada
 * consulta -- sem isso a consulta nem parseia aqui.
 *
 * BASES (montadas aqui, pelos mesmos scripts do rpc-ci.yml):
 *   cheio       a arvore inteira de migrations (o estado 20261210, o do molde do rodar-isolado);
 *   pre         a arvore SEM as duas (o estado de uma loja ANTES do apply: auxiliar de 9 parametros,
 *               RPC e varredura com os corpos de 20261205/20261206);
 *   precrlf     `pre` com a 20261205 e a 20261206 em CRLF (checkout Windows);
 *   m1          `pre` + SO a 20261209000000 (a 20261210 falhou ou nao rodou);
 *   aplicado    `pre` + as duas aplicadas de verdade, em ordem (LF) -- INDISTINGUIVEL de `cheio`;
 *   aplicadocrlf `precrlf` + as duas em CRLF;
 *   volta       `aplicado` + os dois rollbacks manuais (1210 e depois 1209): a IDA E VOLTA.
 *
 * CASOS (cada um com a LINHA exata que reprova; o veredito real, com rol=ok e o ok_false esperado,
 * e' conferido em TODO caso):
 *  16b POSITIVOS  em `pre`, em `precrlf`, em `volta` (depois dos rollbacks); com o papel minimo, com
 *                 search_path trocado e objetos-isca de mesmo nome em outro schema; o papel que sofre
 *                 a RLS do pg_cron e ve zero jobs (NAO VERIFICAVEL, ok).
 *  16b NEGATIVOS  a tabela, a funcao (qualquer sobrecarga) ou o gatilho da foto ja existem; so a
 *                 20261209 aplicada; as duas aplicadas; o auxiliar de 13 parametros ja existe (so ele,
 *                 ou junto com o de 9), ausente, com corpo diferente (1 byte, 1 caractere) ou com
 *                 sobrecarga extra; a RPC e a varredura ausentes, com corpo diferente ou com sobrecarga
 *                 extra, a varredura com o corpo da 20260970; devolver_uso_cupom ausente; coluna de
 *                 marketplace_orders renomeada ou com outro tipo, tabela de pedidos ausente; job
 *                 ausente, inativo, fora de 15 em 15 minutos, ou o papel que atravessa a RLS do
 *                 cron.job com zero jobs.
 *  16a POSITIVOS  em `aplicado` (IGUAL linha a linha a `cheio`), em `aplicadocrlf`, em `volta` depois
 *                 de reaplicar as duas, com o papel minimo, search_path trocado, iscas, o dono da
 *                 varredura em OUTRO papel que TEM EXECUTE no auxiliar, e o papel cego do cron.
 *  16a NEGATIVOS  a tabela da foto ausente, com coluna a mais/tipo/NOT NULL/default alterados, sem
 *                 chave primaria, sem chave estrangeira ou com NO ACTION, sem RLS, com politica ou com
 *                 privilegio (de tabela e de coluna) para PUBLIC/anon/authenticated/service_role; a
 *                 funcao da foto ausente, so outra assinatura, SECURITY INVOKER, sem search_path,
 *                 STABLE, corpo diferente, sobrecarga extra, EXECUTE indevido; o gatilho ausente,
 *                 desligado, ENABLE REPLICA/ALWAYS, BEFORE, sem OF, com mais colunas, FOR EACH
 *                 STATEMENT, sem WHEN, com outro WHEN ou outra funcao; o auxiliar so de 9
 *                 parametros (a 20261210 nao foi aplicada), de 13 E de 9, ausente, com corpo, forma
 *                 ou EXECUTE diferentes; a RPC e a varredura ausentes, com corpo velho (estado
 *                 MISTURADO), forma, sobrecarga ou EXECUTE diferentes; os donos sem EXECUTE no
 *                 auxiliar; devolver_uso_cupom ausente; job ausente, inativo ou fora do horario.
 *  MUTANTES       cada linha das consultas ignorada (menos a de controle, sem negativo local) e cada
 *                 clausula composta desligada no texto do .sql (EXECUTE por papel, donos, job, gatilho,
 *                 colunas, privilegios, o CRLF dos hashes) deixa um caso PASSAR e esta prova ficaria
 *                 VERMELHA -- a saida vermelha de cada um e' impressa.
 *  FECHADO        resposta PARCIAL e linha duplicada tem rol=invalido: o portao NUNCA as trata como
 *                 positivas; o rol de uma consulta nao vale para a outra.
 *  ERRO           SQL truncado (42601), papel sem USAGE no schema cron (42501) e banco inexistente:
 *                 falha ALTA, nenhuma linha VEREDITO-CONSULTA, o portao fica SEM_EVIDENCIA.
 *  PONTA A PONTA  conferir-banco.cjs de verdade (processo filho, HTTP local) e o LOTE do
 *                 canais-de-backend.json REAL no `decidirLote`: ledger sem as versoes + 16a NEGATIVA +
 *                 16b POSITIVA -> APLICAR [20261209000000, 20261210000000] em ordem; ledger com as
 *                 versoes + 16a POSITIVA -> NADA; objetos sem a versao no ledger -> PARAR; so a 1209
 *                 aplicada -> PARAR; 16b negativa -> PARAR; ledger completo com o banco de volta -> PARAR.
 *
 * O LOTE 12 NAO FICA PARA TRAS: no estado que este lote deixa, a 12a (cupom preso) segue POSITIVA
 * (A1 do desenho); sem isso o portao, que exige a prova de todo lote, bloquearia a release.
 *
 * Toda mutacao (de objeto, papel, tabela ou job) leva uma GUARDA que da RAISE se nao aplicou: sem
 * ela, um mutante que nao aplica nada vira falso verde. Papeis temporarios com nome unico,
 * limpos no `finally`.
 *
 * LIMITES DECLARADOS: (1) o Postgres e' o 17 LOCAL; o papel de leitura real da loja
 * (supabase_read_only_user), o Postgres 15/17 da Supabase, o pg_cron real e a ACL real das lojas nao
 * foram medidos aqui. (2) A linha do job so e' estrita quando o papel ve algum job OU atravessa a RLS
 * (row_security_active = false); um papel cego (a RLS do pg_cron vale para ele e ele ve zero jobs)
 * recebe NAO VERIFICAVEL e `ok`, e esta prova afirma isso de proposito. (3) A consulta nao le o
 * comando do job. (4) A linha de EXECUTE da varredura nao cobre service_role (so PUBLIC, anon e
 * authenticated), como na 12a. (5) A linha "controle: funcoes de public visiveis" nao tem negativo
 * local (o catalogo pg_proc e' legivel por todo papel): fica sem mutante. (6) Estas consultas provam
 * OBJETOS; o COMPORTAMENTO (a vaga volta so quando nunca houve cartao) e' de
 * tests/banco/cupom-pix-anulado-viva.cjs.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/cupom-pix-anulado-portao-viva.cjs
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
const { createHash } = require("node:crypto");
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

const A = "16a-conferir-pix-anulado-aplicado";
const B = "16b-antes-pix-anulado-foto-ausente";
const A12 = "12a-conferir-cupom-preso-aplicado";
const V1 = "20261209000000";
const V2 = "20261210000000";
const ARQ1 = "20261209000000_a_foto_da_cobranca_no_cancelamento.sql";
const ARQ2 =
  "20261210000000_a_vaga_do_cupom_do_pix_anulado_volta_em_minutos.sql";
const RB1 = `rollback-manual-${ARQ1}`;
const RB2 = `rollback-manual-${ARQ2}`;
const ARQ205 = "20261205000000_o_cupom_preso_diz_quando_a_vaga_volta.sql";
const ARQ206 =
  "20261206000000_a_vaga_do_cupom_nunca_cobrado_volta_em_uma_hora.sql";
const ARQ970 = "20260970000000_cancelamento_respeita_o_envio.sql";
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const SHA40 = "d".repeat(40);
const SQL = {
  [A]: fs.readFileSync(path.join(CONSULTAS, `${A}.sql`), "utf8"),
  [B]: fs.readFileSync(path.join(CONSULTAS, `${B}.sql`), "utf8"),
  [A12]: fs.readFileSync(path.join(CONSULTAS, `${A12}.sql`), "utf8"),
};
const ROL = {
  [A]: CONF.ROL_DA_16A,
  [B]: CONF.ROL_DA_16B,
  [A12]: CONF.ROL_DA_12A,
};
const N_LINHAS = { [A]: 32, [B]: 14, [A12]: 24 };

const SIG_AUX9 =
  "public.cupom__vaga_volta_em(uuid,text,text,boolean,timestamptz,boolean,timestamptz,text,integer)";
const SIG_AUX13 =
  "public.cupom__vaga_volta_em(uuid,text,text,boolean,timestamptz,boolean,timestamptz,text,integer,text,integer,text,text)";
const SIG_RPC = "public.vaga_do_cupom_presa(text)";
const SIG_VAR = "public.devolver_cupons_de_pedidos_mortos()";
const SIG_FN = "public.pedido__foto_da_cobranca_ao_cancelar()";
const SIG_USO = "public.devolver_uso_cupom(uuid)";
const TAB = "pedido_cobranca_ao_cancelar";
const FN = "pedido__foto_da_cobranca_ao_cancelar";
const TRG = "tr_pedido_foto_da_cobranca_ao_cancelar";
const JOB = "devolver-cupons-de-pedidos-mortos";
const FOTO = `public.${TAB}`;
const PEDIDOS = "public.marketplace_orders";

// Os hashes dos corpos sao recalculados dos ARQUIVOS das migrations (nenhum literal solto aqui)
// e conferidos contra o que as consultas aceitam.
const lerLF = (arq) =>
  fs.readFileSync(path.join(MIGRATIONS, arq), "utf8").replace(/\r\n/g, "\n");
const corpoDe = (texto, cabecalho, tag) => {
  const ini = texto.indexOf(cabecalho);
  assert.ok(ini >= 0, `nao achei ${cabecalho}`);
  const abre = texto.indexOf(`AS ${tag}`, ini) + `AS ${tag}`.length;
  return texto.slice(abre, texto.indexOf(`${tag};`, abre));
};
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const CORPOS = {
  // o estado 20261210 (o que a 16a exige)
  aux13: corpoDe(
    lerLF(ARQ2),
    "CREATE OR REPLACE FUNCTION public.cupom__vaga_volta_em(",
    "$function$",
  ),
  rpc13: corpoDe(
    lerLF(ARQ2),
    "CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(",
    "$function$",
  ),
  var13: corpoDe(
    lerLF(ARQ2),
    "CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()",
    "$devolver_cupons_mortos$",
  ),
  foto: corpoDe(
    lerLF(ARQ1),
    `CREATE OR REPLACE FUNCTION public.${FN}()`,
    "$foto_da_cobranca$",
  ),
  // o estado de antes (o que a 16b exige)
  aux9: corpoDe(
    lerLF(ARQ206),
    "CREATE OR REPLACE FUNCTION public.cupom__vaga_volta_em(",
    "$function$",
  ),
  rpc9: corpoDe(
    lerLF(ARQ205),
    "CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(",
    "$function$",
  ),
  var9: corpoDe(
    lerLF(ARQ206),
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

// Os nomes das linhas (o rol fechado do codigo tem os mesmos).
const AUX = "cupom__vaga_volta_em";
const RPC = "vaga_do_cupom_presa";
const VAR = "devolver_cupons_de_pedidos_mortos";
const CONTROLE = "controle: funcoes de public visiveis a este papel";
const DEP_USO = "dependencia devolver_uso_cupom(uuid): existe";
const JOB_ITEM = `job ${JOB}: agendado a cada 15 min e ativo`;
const LA = {
  controle: CONTROLE,
  fotoCol: `${TAB}: colunas (nome, tipo, NOT NULL, default)`,
  fotoPk: `${TAB}: chave primaria`,
  fotoFk: `${TAB}: chave estrangeira`,
  fotoRls: `${TAB}: seguranca por linha (RLS) ligada`,
  fotoPol: `${TAB}: politicas`,
  fotoPriv: `${TAB}: privilegios de PUBLIC, anon, authenticated e service_role`,
  fnSobre: `${FN}: sobrecargas`,
  fnForma: `${FN}: forma`,
  fnHash: `${FN}: corpo (sha256)`,
  fnAcl: `${FN}: EXECUTE para PUBLIC, anon, authenticated e service_role`,
  trgExiste: `gatilho ${TRG}: existe em marketplace_orders`,
  trgMomento: `gatilho ${TRG}: momento e evento`,
  trgHab: `gatilho ${TRG}: habilitado`,
  trgWhen: `gatilho ${TRG}: condicao WHEN`,
  trgFn: `gatilho ${TRG}: funcao executada`,
  auxSobre: `${AUX}: sobrecargas`,
  auxAssin: `${AUX}: assinatura`,
  auxForma: `${AUX}: forma`,
  auxHash: `${AUX}: corpo (sha256)`,
  auxAcl: `${AUX}: EXECUTE para PUBLIC, anon, authenticated e service_role`,
  rpcSobre: `${RPC}: sobrecargas`,
  rpcForma: `${RPC}: forma`,
  rpcHash: `${RPC}: corpo (sha256)`,
  rpcAcl: `${RPC}: EXECUTE`,
  varSobre: `${VAR}: sobrecargas`,
  varForma: `${VAR}: forma`,
  varHash: `${VAR}: corpo (sha256)`,
  varAcl: `${VAR}: EXECUTE`,
  donos: "donos da varredura e da RPC: EXECUTE no auxiliar",
  depUso: DEP_USO,
  job: JOB_ITEM,
};
const LB = {
  controle: CONTROLE,
  colunas: "marketplace_orders: colunas que o gatilho e as funcoes leem",
  tabela: `${TAB}: tabela`,
  fn: `${FN}: funcao`,
  trg: `gatilho ${TRG}: ausente em marketplace_orders`,
  auxSobre: `${AUX}: sobrecargas`,
  auxAssin: `${AUX}: assinatura`,
  auxHash: `${AUX}: corpo e o da 20261206000000 (sha256)`,
  rpcSobre: `${RPC}: sobrecargas`,
  rpcHash: `${RPC}: corpo e o da 20261205000000 (sha256)`,
  varSobre: `${VAR}: sobrecargas`,
  varHash: `${VAR}: corpo e o da 20261206000000 (sha256)`,
  depUso: DEP_USO,
  job: JOB_ITEM,
};
const FOTO_TODAS = [
  LA.fotoCol,
  LA.fotoPk,
  LA.fotoFk,
  LA.fotoRls,
  LA.fotoPol,
  LA.fotoPriv,
];
const FN_TODAS = [LA.fnSobre, LA.fnForma, LA.fnHash, LA.fnAcl];
const TRG_TODAS = [
  LA.trgExiste,
  LA.trgMomento,
  LA.trgHab,
  LA.trgWhen,
  LA.trgFn,
];
const AUX_TODAS = [
  LA.auxSobre,
  LA.auxAssin,
  LA.auxForma,
  LA.auxHash,
  LA.auxAcl,
];
const RPC_TODAS = [LA.rpcSobre, LA.rpcForma, LA.rpcHash, LA.rpcAcl];
const VAR_TODAS = [LA.varSobre, LA.varForma, LA.varHash, LA.varAcl];
const NAO_VERIFICAVEL = "NAO VERIFICAVEL: este papel nao ve nenhum job do cron";

const ordena = (l) => [...l].sort();
const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const P = {
  ro: `pa_ro_${SUF}`, // LOGIN BYPASSRLS + pg_read_all_data: imita o supabase_read_only_user
  minimo: `pa_min_${SUF}`, // NOLOGIN, so o que a consulta precisa (USAGE em cron, SELECT em cron.job)
  cego: `pa_cego_${SUF}`, // pg_read_all_data SEM BYPASSRLS: a RLS do pg_cron o deixa sem job
  semcron: `pa_sc_${SUF}`, // NOLOGIN sem USAGE no schema cron
  dono: `pa_dono_${SUF}`, // dono alternativo das funcoes (sem EXECUTE no auxiliar)
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
  const nome = `pa_${SUF}_${clones.length}_${rotulo}`.slice(0, 60);
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
/** Monta um banco NOVO: provisiona e aplica as migrations que passam no filtro, pelos mesmos scripts do rpc-ci.yml. */
async function montarBase(nome, filtro) {
  await usar("template1", (a) => a.query(`CREATE DATABASE "${nome}"`));
  clones.push(nome);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-"));
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
/** Aplica, num banco ja existente, SO os arquivos pedidos (com o fim de linha pedido), pelo mesmo script do rpc-ci.yml. */
function aplicarMigracoes(db, arquivos, { crlf = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pa-ap-"));
  try {
    for (const arq of arquivos) {
      let texto = fs
        .readFileSync(path.join(MIGRATIONS, arq), "utf8")
        .replace(/\r\n/g, "\n");
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
/** O pg_cron do banco local e' um stub sem `active`: ganha a coluna (default true, como o pg_cron real) e os privilegios do papel minimo. */
async function prepararCron(db) {
  await usar(db, async (c) => {
    await c.query(
      "ALTER TABLE cron.job ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true",
    );
    await c.query(`GRANT USAGE ON SCHEMA cron TO ${P.minimo}`);
    await c.query(`GRANT SELECT ON cron.job TO ${P.minimo}`);
  });
}
/** Uma mutacao SEGUIDA de uma guarda que da RAISE se ela nao aplicou. `guarda` e' uma expressao booleana que tem de ser VERDADEIRA depois. */
async function mutar(db, rotulo, sql, guarda) {
  await usar(db, async (c) => {
    await c.query(sql);
    await c.query(
      `DO $g$ BEGIN IF NOT COALESCE((${guarda}), false) THEN RAISE EXCEPTION 'a mutacao nao aplicou: ${rotulo.replace(/'/g, "''")}'; END IF; END $g$`,
    );
  });
}
/** Um clone de `de` com a mutacao ja aplicada e verificada. */
async function novo(rotulo, de, sql, guarda) {
  const db = await clonar(rotulo, de);
  await mutar(db, rotulo, sql, guarda);
  return db;
}
const ausente = (sig) => `to_regprocedure('${sig}') IS NULL`;
const existe = (sig) => `to_regprocedure('${sig}') IS NOT NULL`;
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
const hashVivo = (db, sig) =>
  usar(db, async (c) => {
    const r = await c.query(`SELECT ${HASH_DE(sig)} AS h`);
    return r.rows[0].h;
  });
/** Um clone com o corpo de `sig` trocado (a guarda: o hash TEM de mudar). */
async function novoCorpo(rotulo, de, sig, transformar) {
  const db = await clonar(rotulo, de);
  const antes = await hashVivo(db, sig);
  await reescreverCorpo(db, sig, transformar);
  const depois = await hashVivo(db, sig);
  assert.notEqual(depois, antes, `a mutacao nao aplicou: ${rotulo}`);
  return db;
}
const maisUmByte = (c) => `${c} `;
// troca UM caractere sem mudar o que o corpo faz (dentro de um comentario ou, sem comentario, a
// caixa de uma letra do BEGIN: palavra-chave nao distingue maiuscula): so o hash muda
const trocaUmChar = (c) =>
  /--[^\n]*e/.test(c)
    ? c.replace(/(--[^\n]*?)e/, "$1E")
    : c.replace("BEGIN", "BEGiN");

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
    const novoSql = sql.replace(de, () => para);
    assert.notEqual(novoSql, sql);
    sql = novoSql;
  }
  return sql;
}
function imprimeVermelho(rotulo, e) {
  assert.ok(e instanceof assert.AssertionError, String(e));
  console.log(
    `     mutante "${rotulo}" -> VERMELHO: ${String(e.message).split("\n")[0].slice(0, 200)}`,
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
/** O mesmo mutante, mas a troca vale SO dentro do texto de UMA linha (o trecho se repete em outras). */
function trocasNaLinha(rotulo, consulta, item, de, para) {
  const texto = textoDaLinha(consulta, item);
  assert.ok(
    texto.includes(de),
    `${rotulo}: o trecho nao esta na linha ${item}`,
  );
  return [[texto, texto.replace(de, () => para)]];
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

// DDL reutilizados pelos negativos
const CRIA_TRG = (momento, quando, funcao = SIG_FN) =>
  `CREATE TRIGGER ${TRG} ${momento} ON ${PEDIDOS} ${quando} EXECUTE FUNCTION ${funcao}`;
const QUANDO_CERTO =
  "FOR EACH ROW WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')";
const TRIGGER_OUTRA =
  "CREATE FUNCTION public.pa_trg_outra() RETURNS trigger LANGUAGE plpgsql AS $x$ BEGIN RETURN NULL; END $x$";
const guardaTrg = (trecho) =>
  `(SELECT pg_get_triggerdef(t.oid) LIKE '%${trecho}%' FROM pg_trigger t WHERE t.tgrelid = '${PEDIDOS}'::regclass AND t.tgname = '${TRG}')`;
const SQL_DROP_FK = `DO $x$ DECLARE n text; BEGIN SELECT conname INTO n FROM pg_constraint WHERE conrelid = '${FOTO}'::regclass AND contype = 'f'; EXECUTE format('ALTER TABLE ${FOTO} DROP CONSTRAINT %I', n); END $x$`;
const SEM_FK = `NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '${FOTO}'::regclass AND contype = 'f')`;
const SQL_DROP_PK = `DO $x$ DECLARE n text; BEGIN SELECT conname INTO n FROM pg_constraint WHERE conrelid = '${FOTO}'::regclass AND contype = 'p'; EXECUTE format('ALTER TABLE ${FOTO} DROP CONSTRAINT %I', n); END $x$`;
const SEM_PK = `NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '${FOTO}'::regclass AND contype = 'p')`;
const grantExec = (sig, papel) =>
  `GRANT EXECUTE ON FUNCTION ${sig} TO ${papel}`;
const temExec = (sig, papel) =>
  papel === "PUBLIC"
    ? `EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = to_regprocedure('${sig}') AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')`
    : `has_function_privilege('${papel}', to_regprocedure('${sig}'), 'EXECUTE')`;

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
  assert.deepEqual(ordena(CONF.ROL_DA_16A), ordena(Object.values(LA)));
  assert.deepEqual(ordena(CONF.ROL_DA_16B), ordena(Object.values(LB)));

  // Os papeis sao do CLUSTER; a prova os cria (nomes unicos) e os remove no finally.
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

  // ----------------------------------------------------------- precondicao
  {
    const sonda = await usar(MOLDE, async (c) => ({
      funcoes: (
        await c.query(
          "SELECT to_regprocedure($1) IS NOT NULL AS a13, to_regprocedure($2) IS NOT NULL AS a9, to_regprocedure($3) IS NOT NULL AS foto, to_regclass($4) IS NOT NULL AS tabela",
          [SIG_AUX13, SIG_AUX9, SIG_FN, FOTO],
        )
      ).rows[0],
      eu: (
        await c.query(
          "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
        )
      ).rows[0].rolsuper,
      pedidos: (await c.query(`SELECT count(*)::int AS n FROM ${PEDIDOS}`))
        .rows[0].n,
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
      { a13: true, a9: false, foto: true, tabela: true },
      "precondicao: a arvore inteira esta no estado 20261210 (auxiliar de 13 parametros, foto presente)",
    );
    assert.equal(
      sonda.eu,
      true,
      "precondicao: a conexao da prova e superusuario",
    );
    assert.equal(
      sonda.pedidos,
      0,
      "precondicao: o banco migrado comeca sem pedido",
    );
    assert.equal(sonda.papeis, 3, "precondicao: os 3 papeis de fabrica");
    assert.equal(
      sonda.cronActive,
      0,
      "precondicao: o stub do pg_cron local NAO tem a coluna active (esta prova a acrescenta)",
    );
    // o que a 16a e a 16b aceitam e' o que os ARQUIVOS das migrations definem
    for (const k of ["aux13", "rpc13", "var13", "foto"])
      assert.ok(
        SQL[A].includes(`'${HASH[k].lf}'`) &&
          SQL[A].includes(`'${HASH[k].crlf}'`),
        `a 16a tem de aceitar o corpo ${k} (LF e CRLF)`,
      );
    for (const k of ["aux9", "rpc9", "var9"])
      assert.ok(
        SQL[B].includes(`'${HASH[k].lf}'`) &&
          SQL[B].includes(`'${HASH[k].crlf}'`),
        `a 16b tem de aceitar o corpo ${k} (LF e CRLF)`,
      );
    assert.equal(
      new Set(
        ["aux13", "rpc13", "var13", "foto", "aux9", "rpc9", "var9"].flatMap(
          (k) => [HASH[k].lf, HASH[k].crlf],
        ),
      ).size,
      14,
      "os quatorze hashes sao distintos",
    );
    ok(
      "precondicao: o molde tem a arvore inteira (estado 20261210: auxiliar de 13 parametros, foto presente), vazio, conexao superusuario, 3 papeis de fabrica, stub do pg_cron sem `active`; os oito sha256 da 16a e os seis da 16b (LF e CRLF) sao os dos ARQUIVOS das migrations",
    );
  }

  // ----------------------------------------------------------- as bases
  const cheio = await clonar("cheio");
  await prepararCron(cheio);
  const pre = `pa_${SUF}_pre`.slice(0, 60);
  await montarBase(pre, (f) => f !== ARQ1 && f !== ARQ2);
  await prepararCron(pre);
  {
    const sonda = await usar(pre, async (c) => ({
      funcoes: (
        await c.query(
          "SELECT to_regprocedure($1) IS NOT NULL AS a9, to_regprocedure($2) IS NOT NULL AS a13, to_regclass($3) IS NOT NULL AS tabela",
          [SIG_AUX9, SIG_AUX13, FOTO],
        )
      ).rows[0],
      job: (
        await c.query(
          "SELECT schedule, active FROM cron.job WHERE jobname = $1",
          [JOB],
        )
      ).rows,
    }));
    assert.deepEqual(sonda.funcoes, { a9: true, a13: false, tabela: false });
    assert.deepEqual(sonda.job, [{ schedule: "*/15 * * * *", active: true }]);
  }
  const m1 = await clonar("m1", pre);
  aplicarMigracoes(m1, [ARQ1]);
  const aplicado = await clonar("aplicado", pre);
  aplicarMigracoes(aplicado, [ARQ1, ARQ2]);
  // o checkout Windows: as duas anteriores e as duas deste lote em CRLF
  const precrlf = `pa_${SUF}_precrlf`.slice(0, 60);
  await montarBase(
    precrlf,
    (f) => f !== ARQ205 && f !== ARQ206 && f !== ARQ1 && f !== ARQ2,
  );
  await prepararCron(precrlf);
  aplicarMigracoes(precrlf, [ARQ205, ARQ206], { crlf: true });
  const aplicadocrlf = await clonar("aplicadocrlf", precrlf);
  aplicarMigracoes(aplicadocrlf, [ARQ1, ARQ2], { crlf: true });
  await usar(aplicadocrlf, async (c) => {
    const h = (
      await c.query(
        `SELECT ${HASH_DE(SIG_AUX13)} AS a, ${HASH_DE(SIG_RPC)} AS r, ${HASH_DE(SIG_VAR)} AS v, ${HASH_DE(SIG_FN)} AS f`,
      )
    ).rows[0];
    assert.deepEqual(
      h,
      {
        a: HASH.aux13.crlf,
        r: HASH.rpc13.crlf,
        v: HASH.var13.crlf,
        f: HASH.foto.crlf,
      },
      "guarda: os quatro corpos ficaram em CRLF no banco",
    );
  });
  await usar(precrlf, async (c) => {
    const h = (
      await c.query(
        `SELECT ${HASH_DE(SIG_AUX9)} AS a, ${HASH_DE(SIG_RPC)} AS r, ${HASH_DE(SIG_VAR)} AS v`,
      )
    ).rows[0];
    assert.deepEqual(
      h,
      { a: HASH.aux9.crlf, r: HASH.rpc9.crlf, v: HASH.var9.crlf },
      "guarda: os tres corpos de antes ficaram em CRLF no banco",
    );
  });
  // a IDA E VOLTA: os dois rollbacks manuais (1210 e depois 1209) sobre `aplicado`
  const volta = await clonar("volta", aplicado);
  await usar(volta, async (c) => {
    await c.query(fs.readFileSync(path.join(MIGRATIONS, RB2), "utf8"));
    await c.query(fs.readFileSync(path.join(MIGRATIONS, RB1), "utf8"));
  });
  ok(
    "bases montadas: cheio (arvore inteira = estado 20261210), pre (sem as duas: auxiliar de 9 parametros, sem foto, job */15 ativo), precrlf (pre com 1205/1206 em CRLF), m1 (pre + so a 20261209), aplicado (pre + 20261209 e 20261210 aplicadas de verdade, LF), aplicadocrlf (idem em CRLF, quatro corpos gravados em CRLF) e volta (aplicado + os dois rollbacks manuais)",
  );

  // ----------------------------------------------------------- 16b POSITIVOS
  {
    const rows = await rodar(pre, B);
    await exigirPositiva(B, "16b em pre", rows);
    assert.equal(linha(rows, LB.tabela).vivo, "AUSENTE");
    assert.equal(linha(rows, LB.fn).vivo, "AUSENTE");
    assert.equal(linha(rows, LB.trg).vivo, "AUSENTE");
    assert.equal(linha(rows, LB.auxAssin).vivo, "so a de 9 parametros");
    assert.equal(linha(rows, LB.auxHash).vivo, HASH.aux9.lf);
    assert.equal(linha(rows, LB.rpcHash).vivo, HASH.rpc9.lf);
    assert.equal(linha(rows, LB.varHash).vivo, HASH.var9.lf);
    assert.equal(linha(rows, LB.job).vivo, "ativo */15 * * * *");
    const rowsCrlf = await rodar(precrlf, B);
    await exigirPositiva(B, "16b em precrlf", rowsCrlf);
    assert.equal(linha(rowsCrlf, LB.auxHash).vivo, HASH.aux9.lf);
    assert.equal(linha(rowsCrlf, LB.rpcHash).vivo, HASH.rpc9.lf);
    assert.equal(linha(rowsCrlf, LB.varHash).vivo, HASH.var9.lf);
    // a ida e volta: depois dos rollbacks a loja e' a de antes (a tabela, a funcao e o gatilho da foto sumiram)
    const rowsVolta = await rodar(volta, B);
    await exigirPositiva(B, "16b em volta (depois dos rollbacks)", rowsVolta);
    assert.equal(linha(rowsVolta, LB.auxHash).vivo, HASH.aux9.lf);
    ok(
      "16b POSITIVA na base de ANTES (foto ausente, auxiliar de 9 parametros, corpos de 1205/1206, 12 colunas, dependencia, job */15 ativo), com os corpos de antes em CRLF e DEPOIS dos dois rollbacks manuais (a IDA E VOLTA devolve a loja ao estado de antes)",
    );
  }
  {
    const isca = `CREATE SCHEMA pa_isca;
       CREATE TABLE pa_isca.marketplace_orders (id int, status int);
       CREATE TABLE pa_isca.${TAB} (order_id int);
       CREATE FUNCTION pa_isca.${AUX}(p int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
       CREATE FUNCTION pa_isca.${RPC}(p text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
       CREATE FUNCTION pa_isca.${VAR}() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
       CREATE FUNCTION pa_isca.${FN}() RETURNS trigger LANGUAGE plpgsql AS $x$ BEGIN RETURN NULL; END $x$;
       CREATE FUNCTION pa_isca.devolver_uso_cupom(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
       GRANT USAGE ON SCHEMA pa_isca TO PUBLIC`;
    const guardaIsca = "to_regclass('pa_isca.marketplace_orders') IS NOT NULL";
    const preIscas = await novo("preiscas", pre, isca, guardaIsca);
    const aplicadoIscas = await novo(
      "aplicadoiscas",
      aplicado,
      isca,
      guardaIsca,
    );
    await exigirPositiva(
      B,
      "16b papel minimo",
      await rodar(pre, B, { papel: P.minimo }),
    );
    await exigirPositiva(
      B,
      "16b search_path vazio",
      await rodar(pre, B, { antes: ["SET search_path = ''"] }),
    );
    await exigirPositiva(
      B,
      "16b com iscas a frente do search_path (a isca de mesmo nome NAO conta como a foto)",
      await rodar(preIscas, B, {
        antes: ["SET search_path = pa_isca, pg_catalog"],
      }),
    );
    await exigirPositiva(
      A,
      "16a papel minimo",
      await rodar(aplicado, A, { papel: P.minimo }),
    );
    await exigirPositiva(
      A,
      "16a search_path vazio",
      await rodar(aplicado, A, { antes: ["SET search_path = ''"] }),
    );
    await exigirPositiva(
      A,
      "16a com iscas a frente do search_path",
      await rodar(aplicadoIscas, A, {
        antes: ["SET search_path = pa_isca, pg_catalog"],
      }),
    );
    ok(
      "16a e 16b POSITIVAS tambem com o papel minimo (so USAGE em cron e SELECT em cron.job), com search_path vazio e com objetos-isca de mesmo nome em outro schema (tudo e' nomeado com schema)",
    );
  }

  // ----------------------------------------------------------- 16a POSITIVOS
  const rowsCheio = await rodar(cheio, A);
  await exigirPositiva(A, "16a em cheio", rowsCheio);
  {
    const rowsAplicado = await rodar(aplicado, A);
    await exigirPositiva(A, "16a em aplicado", rowsAplicado);
    assert.deepEqual(
      rowsAplicado,
      rowsCheio,
      "o apply isolado dos ARQUIVOS sobre a base de antes e' indistinguivel da arvore inteira",
    );
    for (const [item, chave] of [
      [LA.auxHash, "aux13"],
      [LA.rpcHash, "rpc13"],
      [LA.varHash, "var13"],
      [LA.fnHash, "foto"],
    ]) {
      assert.equal(linha(rowsAplicado, item).vivo, HASH[chave].lf, item);
      assert.equal(linha(rowsAplicado, item).esperado, HASH[chave].lf, item);
    }
    assert.equal(
      linha(rowsAplicado, LA.auxAssin).vivo,
      "so a de 13 parametros",
    );
    assert.equal(linha(rowsAplicado, LA.auxSobre).vivo, "1");
    assert.equal(linha(rowsAplicado, LA.auxAcl).vivo, "nenhum");
    assert.equal(linha(rowsAplicado, LA.fnAcl).vivo, "nenhum");
    assert.equal(
      linha(rowsAplicado, LA.rpcAcl).vivo,
      "PUBLIC=nao anon=nao authenticated=sim service_role=nao",
    );
    assert.equal(linha(rowsAplicado, LA.donos).vivo, "sim");
    assert.equal(linha(rowsAplicado, LA.fotoPol).vivo, "nenhuma");
    assert.equal(linha(rowsAplicado, LA.fotoPriv).vivo, "nenhum");
    assert.equal(linha(rowsAplicado, LA.fotoRls).vivo, "sim");
    assert.equal(linha(rowsAplicado, LA.trgHab).vivo, "O");
    assert.equal(
      linha(rowsAplicado, LA.trgMomento).vivo,
      "AFTER UPDATE OF status FOR EACH ROW",
    );
    assert.equal(linha(rowsAplicado, LA.job).vivo, "ativo */15 * * * *");
    const rowsCrlf = await rodar(aplicadocrlf, A);
    await exigirPositiva(A, "16a em aplicadocrlf", rowsCrlf);
    for (const [item, chave] of [
      [LA.auxHash, "aux13"],
      [LA.rpcHash, "rpc13"],
      [LA.varHash, "var13"],
      [LA.fnHash, "foto"],
    ])
      assert.equal(linha(rowsCrlf, item).vivo, HASH[chave].lf, item);
    // a ida e volta, de novo para a frente: o rollback seguido de um novo apply do ARQUIVO volta ao estado de depois
    const reida = await clonar("reida", volta);
    await usar(reida, async (c) => {
      await c.query(fs.readFileSync(path.join(MIGRATIONS, ARQ1), "utf8"));
      await c.query(fs.readFileSync(path.join(MIGRATIONS, ARQ2), "utf8"));
    });
    await exigirPositiva(
      A,
      "16a em reida (rollback e novo apply)",
      await rodar(reida, A),
    );
    ok(
      "16a POSITIVA (32 linhas, rol=ok, portao POSITIVA) depois do apply real (LF: IGUAL linha a linha a arvore inteira; CRLF: os quatro corpos gravados em CRLF e o `esperado` continua o LF), e depois de rollback seguido de um novo apply (ida, volta e ida)",
    );
  }
  // O dono da varredura e' OUTRO papel, mas com EXECUTE no auxiliar: a linha dos donos mede o privilegio, nao a igualdade.
  {
    const donoComExecute = await novo(
      "donoexec",
      aplicado,
      `GRANT CREATE ON SCHEMA public TO ${P.dono};
       GRANT EXECUTE ON FUNCTION ${SIG_AUX13} TO ${P.dono};
       ALTER FUNCTION ${SIG_VAR} OWNER TO ${P.dono}`,
      `(SELECT pg_get_userbyid(proowner) = '${P.dono}' FROM pg_proc WHERE oid = to_regprocedure('${SIG_VAR}'))`,
    );
    await exigirPositiva(
      A,
      "16a com o dono da varredura em outro papel que TEM EXECUTE no auxiliar",
      await rodar(donoComExecute, A),
    );
  }
  // O papel que nao ve job nenhum (RLS do pg_cron): NAO VERIFICAVEL, e ok.
  const RLS_CRON = "ALTER TABLE cron.job ENABLE ROW LEVEL SECURITY";
  const GUARDA_RLS_CRON =
    "(SELECT relrowsecurity FROM pg_class WHERE oid = 'cron.job'::regclass)";
  const cegoA = await novo("cegoa", aplicado, RLS_CRON, GUARDA_RLS_CRON);
  const cegoB = await novo("cegob", pre, RLS_CRON, GUARDA_RLS_CRON);
  {
    const rowsA = await rodar(cegoA, A, { papel: P.cego });
    await exigirPositiva(A, "16a papel cego", rowsA);
    assert.equal(linha(rowsA, LA.job).vivo, NAO_VERIFICAVEL);
    assert.equal(linha(rowsA, LA.job).esperado, NAO_VERIFICAVEL);
    const rowsB = await rodar(cegoB, B, { papel: P.cego });
    await exigirPositiva(B, "16b papel cego", rowsB);
    assert.equal(linha(rowsB, LB.job).vivo, NAO_VERIFICAVEL);
  }
  // O LOTE 12 nao fica para tras: depois deste lote a 12a (cupom preso) segue POSITIVA (A1)
  {
    const rows12 = await rodar(aplicado, A12);
    await exigirPositiva(A12, "12a no estado que este lote deixa", rows12);
    await exigirPositiva(A12, "12a em cheio", await rodar(cheio, A12));
    ok(
      "a 12a (lote do cupom preso) segue POSITIVA no estado que este lote deixa (arquivos aplicados e arvore inteira): a loja que recebe o lote 16 nao fica com o lote 12 vermelho; o papel cego do cron recebe NAO VERIFICAVEL e ok na 16a e na 16b",
    );
  }

  // ----------------------------------------------------------- 16b NEGATIVOS
  const CASOS_B = []; // [rotulo, db, esperadas, opcoes]
  const nb = async (rotulo, de, sql, guarda, esperadas, extra) => {
    const db = await novo(rotulo, de, sql, guarda);
    CASOS_B.push([rotulo, db, esperadas, {}]);
    if (extra) await extra(db);
    return db;
  };
  const nbCorpo = async (rotulo, sig, transformar, esperadas) => {
    const db = await novoCorpo(rotulo, pre, sig, transformar);
    CASOS_B.push([rotulo, db, esperadas, {}]);
    return db;
  };
  const SQL_FN_FOTO = `CREATE FUNCTION ${SIG_FN} RETURNS trigger LANGUAGE plpgsql AS $x$ BEGIN RETURN NULL; END $x$`;
  const CRIA_AUX13 = `CREATE FUNCTION ${SIG_AUX13} RETURNS timestamptz LANGUAGE sql AS 'SELECT now()'`;
  await nb(
    "b-tabela",
    pre,
    `CREATE TABLE ${FOTO} (order_id uuid)`,
    `to_regclass('${FOTO}') IS NOT NULL`,
    [LB.tabela],
  );
  await nb("b-fn", pre, SQL_FN_FOTO, existe(SIG_FN), [LB.fn]);
  await nb(
    "b-fn-sobrecarga",
    pre,
    `CREATE FUNCTION public.${FN}(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    existe(`public.${FN}(integer)`),
    [LB.fn],
  );
  await nb(
    "b-gatilho",
    pre,
    `${TRIGGER_OUTRA}; ${CRIA_TRG("AFTER UPDATE OF status", QUANDO_CERTO, "public.pa_trg_outra()")}`,
    guardaTrg("AFTER UPDATE"),
    [LB.trg],
  );
  await nb(
    "b-so-a-1209",
    m1,
    "SELECT 1",
    `to_regclass('${FOTO}') IS NOT NULL`,
    [LB.tabela, LB.fn, LB.trg],
  );
  await nb("b-as-duas", aplicado, "SELECT 1", existe(SIG_AUX13), [
    LB.tabela,
    LB.fn,
    LB.trg,
    LB.auxAssin,
    LB.auxHash,
    LB.rpcHash,
    LB.varHash,
  ]);
  await nb("b-aux-13-e-9", pre, CRIA_AUX13, existe(SIG_AUX13), [
    LB.auxSobre,
    LB.auxAssin,
  ]);
  await nbCorpo("b-aux-byte", SIG_AUX9, maisUmByte, [LB.auxHash]);
  await nbCorpo("b-aux-char", SIG_AUX9, trocaUmChar, [LB.auxHash]);
  await nb(
    "b-aux-ausente",
    pre,
    `DROP FUNCTION ${SIG_AUX9}`,
    ausente(SIG_AUX9),
    [LB.auxSobre, LB.auxAssin, LB.auxHash],
  );
  await nb(
    "b-aux-sobrecarga",
    pre,
    `CREATE FUNCTION public.${AUX}(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    existe(`public.${AUX}(integer)`),
    [LB.auxSobre],
  );
  await nbCorpo("b-rpc-byte", SIG_RPC, maisUmByte, [LB.rpcHash]);
  await nbCorpo("b-rpc-char", SIG_RPC, trocaUmChar, [LB.rpcHash]);
  await nb("b-rpc-ausente", pre, `DROP FUNCTION ${SIG_RPC}`, ausente(SIG_RPC), [
    LB.rpcSobre,
    LB.rpcHash,
  ]);
  await nb(
    "b-rpc-sobrecarga",
    pre,
    `CREATE FUNCTION public.${RPC}(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    existe(`public.${RPC}(integer)`),
    [LB.rpcSobre],
  );
  await nbCorpo("b-var-byte", SIG_VAR, maisUmByte, [LB.varHash]);
  await nbCorpo("b-var-char", SIG_VAR, trocaUmChar, [LB.varHash]);
  await nbCorpo("b-var-970", SIG_VAR, () => CORPOS.var970, [LB.varHash]);
  await nb("b-var-ausente", pre, `DROP FUNCTION ${SIG_VAR}`, ausente(SIG_VAR), [
    LB.varSobre,
    LB.varHash,
  ]);
  await nb(
    "b-var-sobrecarga",
    pre,
    `CREATE FUNCTION public.${VAR}(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    existe(`public.${VAR}(integer)`),
    [LB.varSobre],
  );
  await nb(
    "b-dep-uso",
    pre,
    `ALTER FUNCTION ${SIG_USO} RENAME TO pa_devolver_uso_cupom`,
    ausente(SIG_USO),
    [LB.depUso],
  );
  await nb(
    "b-coluna-renomeada",
    pre,
    `ALTER TABLE ${PEDIDOS} RENAME COLUMN expires_at TO pa_expires_at`,
    `NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '${PEDIDOS}'::regclass AND attname = 'expires_at' AND NOT attisdropped)`,
    [LB.colunas],
  );
  await nb(
    "b-coluna-tipo-texto",
    pre,
    `ALTER TABLE ${PEDIDOS} ALTER COLUMN gateway_payment_id TYPE varchar(255)`,
    `(SELECT format_type(atttypid, atttypmod) = 'character varying(255)' FROM pg_attribute WHERE attrelid = '${PEDIDOS}'::regclass AND attname = 'gateway_payment_id')`,
    [LB.colunas],
  );
  await nb(
    "b-coluna-tipo-int",
    pre,
    `ALTER TABLE ${PEDIDOS} ALTER COLUMN tentativas_de_pagamento TYPE bigint`,
    `(SELECT format_type(atttypid, atttypmod) = 'bigint' FROM pg_attribute WHERE attrelid = '${PEDIDOS}'::regclass AND attname = 'tentativas_de_pagamento')`,
    [LB.colunas],
  );
  const bSemPedidos = await nb(
    "b-sem-pedidos",
    pre,
    `ALTER TABLE ${PEDIDOS} RENAME TO pa_marketplace_orders`,
    `to_regclass('${PEDIDOS}') IS NULL`,
    [LB.colunas],
  );
  assert.equal(
    linha(await rodar(bSemPedidos, B), LB.colunas).vivo,
    "AUSENTE: a tabela marketplace_orders",
  );
  const DECOY = `INSERT INTO cron.job (jobname, schedule, command) VALUES ('pa_isca_job', '0 0 * * *', 'SELECT 1')`;
  const bJobAus = await nb(
    "b-job-ausente",
    pre,
    `${DECOY}; DELETE FROM cron.job WHERE jobname = '${JOB}'`,
    `NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = '${JOB}') AND EXISTS (SELECT 1 FROM cron.job)`,
    [LB.job],
  );
  assert.equal(linha(await rodar(bJobAus, B), LB.job).vivo, "AUSENTE");
  const bJobIna = await nb(
    "b-job-inativo",
    pre,
    `UPDATE cron.job SET active = false WHERE jobname = '${JOB}'`,
    `(SELECT NOT active FROM cron.job WHERE jobname = '${JOB}')`,
    [LB.job],
  );
  assert.equal(
    linha(await rodar(bJobIna, B), LB.job).vivo,
    "inativo */15 * * * *",
  );
  const bJobHor = await nb(
    "b-job-horario",
    pre,
    `UPDATE cron.job SET schedule = '*/5 * * * *' WHERE jobname = '${JOB}'`,
    `(SELECT schedule = '*/5 * * * *' FROM cron.job WHERE jobname = '${JOB}')`,
    [LB.job],
  );
  assert.equal(
    linha(await rodar(bJobHor, B), LB.job).vivo,
    "ativo */5 * * * *",
  );
  // quem ATRAVESSA a RLS do cron.job (BYPASSRLS) e ve ZERO jobs nao e' cego: o zero e' a verdade
  const SEM_JOBS_COM_RLS =
    "ALTER TABLE cron.job ENABLE ROW LEVEL SECURITY; DELETE FROM cron.job";
  const GUARDA_SEM_JOBS_COM_RLS = `${GUARDA_RLS_CRON} AND NOT EXISTS (SELECT 1 FROM cron.job)`;
  const bSemJobs = await nb(
    "b-sem-jobs",
    pre,
    SEM_JOBS_COM_RLS,
    GUARDA_SEM_JOBS_COM_RLS,
    [LB.job],
  );
  CASOS_B.push([
    "b-tabela-sem-rls-sem-jobs",
    await novo(
      "b-sem-rls-sem-jobs",
      pre,
      "DELETE FROM cron.job",
      `NOT EXISTS (SELECT 1 FROM cron.job) AND NOT ${GUARDA_RLS_CRON}`,
    ),
    [LB.job],
    { papel: P.cego },
  ]);
  for (const [rotulo, db, esperadas, opcoes] of CASOS_B)
    await negativo(B, `16b ${rotulo}`, db, esperadas, opcoes);
  {
    // o papel cego com zero jobs recebe NAO VERIFICAVEL e ok (positivo) -- o que atravessa a RLS reprova (acima)
    const rows = await rodar(bSemJobs, B, { papel: P.cego });
    await exigirPositiva(B, "16b papel cego + zero jobs", rows);
    assert.equal(linha(rows, LB.job).vivo, NAO_VERIFICAVEL);
    assert.equal(
      linha(await rodar(bSemJobs, B), LB.job).vivo,
      "AUSENTE",
      "o papel que atravessa a RLS com zero jobs diz AUSENTE",
    );
  }
  ok(
    `16b NEGATIVA, UMA linha certa por defeito (${CASOS_B.length} casos): a tabela, a funcao (inclusive so OUTRA assinatura) ou o gatilho da foto ja existem; so a 20261209 aplicada; as duas aplicadas (7 linhas); o auxiliar de 13 junto com o de 9, ausente, com 1 byte ou 1 caractere a mais/trocado ou sobrecarga extra; a RPC e a varredura ausentes, com corpo diferente (a varredura com o corpo da 20260970) ou sobrecarga extra; devolver_uso_cupom ausente; coluna de marketplace_orders renomeada ou com outro tipo; tabela de pedidos ausente; job ausente, inativo, fora de 15 em 15, o papel que atravessa a RLS do cron.job com zero jobs e a tabela sem RLS com zero jobs`,
  );

  // ----------------------------------------------------------- 16a NEGATIVOS
  const CASOS_A = [];
  const na = async (
    rotulo,
    sql,
    guarda,
    esperadas,
    opcoes = {},
    de = aplicado,
  ) => {
    const db = await novo(rotulo, de, sql, guarda);
    CASOS_A.push([rotulo, db, esperadas, opcoes]);
    return db;
  };
  const naCorpo = async (rotulo, sig, transformar, esperadas) => {
    const db = await novoCorpo(rotulo, aplicado, sig, transformar);
    CASOS_A.push([rotulo, db, esperadas, {}]);
    return db;
  };
  const colunaDaFoto = (nome) =>
    `(SELECT attname FROM pg_attribute WHERE attrelid = '${FOTO}'::regclass AND attname = '${nome}' AND NOT attisdropped)`;
  // -- a tabela da foto
  await na(
    "a-sem-tabela",
    `DROP TABLE ${FOTO}`,
    `to_regclass('${FOTO}') IS NULL`,
    [LA.fotoCol, LA.fotoPk, LA.fotoFk, LA.fotoRls, LA.fotoPol, LA.fotoPriv],
  );
  await na(
    "a-coluna-a-mais",
    `ALTER TABLE ${FOTO} ADD COLUMN pa_x integer`,
    `${colunaDaFoto("pa_x")} IS NOT NULL`,
    [LA.fotoCol],
  );
  await na(
    "a-coluna-tentativas-sem-not-null",
    `ALTER TABLE ${FOTO} ALTER COLUMN tentativas DROP NOT NULL`,
    `(SELECT NOT attnotnull FROM pg_attribute WHERE attrelid = '${FOTO}'::regclass AND attname = 'tentativas')`,
    [LA.fotoCol],
  );
  await na(
    "a-coluna-sem-default",
    `ALTER TABLE ${FOTO} ALTER COLUMN cancelado_em DROP DEFAULT`,
    `NOT EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid = '${FOTO}'::regclass AND d.adnum = (SELECT attnum FROM pg_attribute WHERE attrelid = '${FOTO}'::regclass AND attname = 'cancelado_em'))`,
    [LA.fotoCol],
  );
  await na(
    "a-coluna-outro-tipo",
    `ALTER TABLE ${FOTO} ALTER COLUMN metodo_online TYPE varchar(30)`,
    `(SELECT format_type(atttypid, atttypmod) = 'character varying(30)' FROM pg_attribute WHERE attrelid = '${FOTO}'::regclass AND attname = 'metodo_online')`,
    [LA.fotoCol],
  );
  await na(
    "a-coluna-renomeada",
    `ALTER TABLE ${FOTO} RENAME COLUMN payment_status TO pa_payment_status`,
    `${colunaDaFoto("payment_status")} IS NULL`,
    [LA.fotoCol],
  );
  await na("a-sem-pk", SQL_DROP_PK, SEM_PK, [LA.fotoPk]);
  await na("a-sem-fk", SQL_DROP_FK, SEM_FK, [LA.fotoFk]);
  await na(
    "a-fk-sem-cascade",
    `${SQL_DROP_FK}; ALTER TABLE ${FOTO} ADD FOREIGN KEY (order_id) REFERENCES ${PEDIDOS} (id)`,
    `(SELECT confdeltype = 'a' FROM pg_constraint WHERE conrelid = '${FOTO}'::regclass AND contype = 'f')`,
    [LA.fotoFk],
  );
  await na(
    "a-sem-rls",
    `ALTER TABLE ${FOTO} DISABLE ROW LEVEL SECURITY`,
    `NOT (SELECT relrowsecurity FROM pg_class WHERE oid = '${FOTO}'::regclass)`,
    [LA.fotoRls],
  );
  await na(
    "a-politica",
    `CREATE POLICY pa_pol ON ${FOTO} FOR SELECT TO authenticated USING (true)`,
    `EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = '${FOTO}'::regclass)`,
    [LA.fotoPol],
  );
  for (const [papel, priv] of [
    ["authenticated", "SELECT"],
    ["anon", "INSERT"],
    ["service_role", "UPDATE"],
    ["PUBLIC", "SELECT"],
  ])
    await na(
      `a-privilegio-${papel}`,
      `GRANT ${priv} ON ${FOTO} TO ${papel}`,
      papel === "PUBLIC"
        ? `EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = '${FOTO}'::regclass AND a.grantee = 0)`
        : `has_table_privilege('${papel}', '${FOTO}', '${priv}')`,
      [LA.fotoPriv],
    );
  await na(
    "a-privilegio-de-coluna-authenticated",
    `GRANT SELECT (order_id) ON ${FOTO} TO authenticated`,
    `has_column_privilege('authenticated', '${FOTO}', 'order_id', 'SELECT')`,
    [LA.fotoPriv],
  );
  // DELETE/TRUNCATE/TRIGGER so existem no nivel da TABELA (nao ha privilegio de coluna): sao eles que
  // provam a clausula de tabela dos papeis nomeados (SELECT/INSERT/UPDATE/REFERENCES tambem aparecem
  // pelo privilegio de coluna, que um privilegio de tabela implica)
  await na(
    "a-privilegio-delete-anon",
    `GRANT DELETE ON ${FOTO} TO anon`,
    `has_table_privilege('anon', '${FOTO}', 'DELETE')`,
    [LA.fotoPriv],
  );
  await na(
    "a-privilegio-de-coluna-PUBLIC",
    `GRANT UPDATE (tentativas) ON ${FOTO} TO PUBLIC`,
    `EXISTS (SELECT 1 FROM pg_attribute pa, aclexplode(pa.attacl) a WHERE pa.attrelid = '${FOTO}'::regclass AND pa.attacl IS NOT NULL AND a.grantee = 0)`,
    [LA.fotoPriv],
  );
  // -- a funcao da foto
  await na("a-fn-ausente", `DROP FUNCTION ${SIG_FN} CASCADE`, ausente(SIG_FN), [
    ...FN_TODAS,
    ...TRG_TODAS,
  ]);
  await na(
    "a-fn-so-outra-assinatura",
    `DROP FUNCTION ${SIG_FN} CASCADE; CREATE FUNCTION public.${FN}(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    `${ausente(SIG_FN)} AND ${existe(`public.${FN}(integer)`)}`,
    [LA.fnForma, LA.fnHash, LA.fnAcl, ...TRG_TODAS],
  );
  await na(
    "a-fn-sobrecarga",
    `CREATE FUNCTION public.${FN}(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    existe(`public.${FN}(integer)`),
    [LA.fnSobre],
  );
  await na(
    "a-fn-invoker",
    `ALTER FUNCTION ${SIG_FN} SECURITY INVOKER`,
    `NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('${SIG_FN}'))`,
    [LA.fnForma],
  );
  await na(
    "a-fn-sem-search-path",
    `ALTER FUNCTION ${SIG_FN} RESET search_path`,
    `(SELECT proconfig IS NULL FROM pg_proc WHERE oid = to_regprocedure('${SIG_FN}'))`,
    [LA.fnForma],
  );
  await na(
    "a-fn-stable",
    `ALTER FUNCTION ${SIG_FN} STABLE`,
    `(SELECT provolatile = 's' FROM pg_proc WHERE oid = to_regprocedure('${SIG_FN}'))`,
    [LA.fnForma],
  );
  await naCorpo("a-fn-byte", SIG_FN, maisUmByte, [LA.fnHash]);
  await naCorpo("a-fn-char", SIG_FN, trocaUmChar, [LA.fnHash]);
  for (const papel of ["PUBLIC", "anon", "authenticated", "service_role"])
    await na(
      `a-fn-exec-${papel}`,
      grantExec(SIG_FN, papel),
      temExec(SIG_FN, papel),
      [LA.fnAcl],
    );
  // -- o gatilho
  const dropTrg = `DROP TRIGGER ${TRG} ON ${PEDIDOS}`;
  const semTrg = `NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = '${PEDIDOS}'::regclass AND tgname = '${TRG}')`;
  await na("a-gatilho-ausente", dropTrg, semTrg, TRG_TODAS);
  await na(
    "a-gatilho-desligado",
    `ALTER TABLE ${PEDIDOS} DISABLE TRIGGER ${TRG}`,
    `(SELECT tgenabled = 'D' FROM pg_trigger WHERE tgrelid = '${PEDIDOS}'::regclass AND tgname = '${TRG}')`,
    [LA.trgHab],
  );
  await na(
    "a-gatilho-replica",
    `ALTER TABLE ${PEDIDOS} ENABLE REPLICA TRIGGER ${TRG}`,
    `(SELECT tgenabled = 'R' FROM pg_trigger WHERE tgrelid = '${PEDIDOS}'::regclass AND tgname = '${TRG}')`,
    [LA.trgHab],
  );
  await na(
    "a-gatilho-always",
    `ALTER TABLE ${PEDIDOS} ENABLE ALWAYS TRIGGER ${TRG}`,
    `(SELECT tgenabled = 'A' FROM pg_trigger WHERE tgrelid = '${PEDIDOS}'::regclass AND tgname = '${TRG}')`,
    [LA.trgHab],
  );
  await na(
    "a-gatilho-before",
    `${dropTrg}; ${CRIA_TRG("BEFORE UPDATE OF status", QUANDO_CERTO)}`,
    guardaTrg("BEFORE UPDATE OF status"),
    [LA.trgMomento],
  );
  await na(
    "a-gatilho-sem-of",
    `${dropTrg}; ${CRIA_TRG("AFTER UPDATE", QUANDO_CERTO)}`,
    `${guardaTrg("AFTER UPDATE ON")} AND NOT ${guardaTrg("UPDATE OF")}`,
    [LA.trgMomento],
  );
  await na(
    "a-gatilho-mais-colunas",
    `${dropTrg}; ${CRIA_TRG("AFTER UPDATE OF status, payment_status", QUANDO_CERTO)}`,
    guardaTrg("UPDATE OF status, payment_status"),
    [LA.trgMomento],
  );
  await na(
    "a-gatilho-por-comando",
    `${dropTrg}; ${CRIA_TRG("AFTER UPDATE OF status", "FOR EACH STATEMENT")}`,
    guardaTrg("FOR EACH STATEMENT"),
    [LA.trgMomento, LA.trgWhen],
  );
  await na(
    "a-gatilho-sem-when",
    `${dropTrg}; ${CRIA_TRG("AFTER UPDATE OF status", "FOR EACH ROW")}`,
    `NOT ${guardaTrg(" WHEN ")}`,
    [LA.trgWhen],
  );
  await na(
    "a-gatilho-outro-when",
    `${dropTrg}; ${CRIA_TRG("AFTER UPDATE OF status", "FOR EACH ROW WHEN (NEW.status = 'cancelled')")}`,
    `${guardaTrg(" WHEN ")} AND NOT ${guardaTrg("DISTINCT")}`,
    [LA.trgWhen],
  );
  await na(
    "a-gatilho-outra-funcao",
    `${TRIGGER_OUTRA}; ${dropTrg}; ${CRIA_TRG("AFTER UPDATE OF status", QUANDO_CERTO, "public.pa_trg_outra()")}`,
    guardaTrg("pa_trg_outra"),
    [LA.trgFn],
  );
  await na(
    "a-pedidos-ausente",
    `ALTER TABLE ${PEDIDOS} RENAME TO pa_marketplace_orders`,
    `to_regclass('${PEDIDOS}') IS NULL`,
    [LA.fotoFk, ...TRG_TODAS],
  );
  // -- o auxiliar
  await na(
    "a-aux-13-e-9",
    `CREATE FUNCTION ${SIG_AUX9} RETURNS timestamptz LANGUAGE sql AS 'SELECT now()'`,
    existe(SIG_AUX9),
    [LA.auxSobre, LA.auxAssin],
  );
  await na("a-aux-ausente", `DROP FUNCTION ${SIG_AUX13}`, ausente(SIG_AUX13), [
    ...AUX_TODAS,
    LA.donos,
  ]);
  await naCorpo("a-aux-byte", SIG_AUX13, maisUmByte, [LA.auxHash]);
  await naCorpo("a-aux-char", SIG_AUX13, trocaUmChar, [LA.auxHash]);
  await na(
    "a-aux-volatile",
    `ALTER FUNCTION ${SIG_AUX13} VOLATILE`,
    `(SELECT provolatile = 'v' FROM pg_proc WHERE oid = to_regprocedure('${SIG_AUX13}'))`,
    [LA.auxForma],
  );
  await na(
    "a-aux-definer",
    `ALTER FUNCTION ${SIG_AUX13} SECURITY DEFINER`,
    `(SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('${SIG_AUX13}'))`,
    [LA.auxForma],
  );
  await na(
    "a-aux-sem-search-path",
    `ALTER FUNCTION ${SIG_AUX13} RESET search_path`,
    `(SELECT proconfig IS NULL FROM pg_proc WHERE oid = to_regprocedure('${SIG_AUX13}'))`,
    [LA.auxForma],
  );
  for (const papel of ["PUBLIC", "anon", "authenticated", "service_role"])
    await na(
      `a-aux-exec-${papel}`,
      grantExec(SIG_AUX13, papel),
      temExec(SIG_AUX13, papel),
      [LA.auxAcl],
    );
  // a 20261210 NAO foi aplicada (so a foto): o estado da loja entre os dois applies
  await na(
    "a-so-a-1209",
    "SELECT 1",
    existe(SIG_AUX9),
    [
      LA.auxAssin,
      LA.auxForma,
      LA.auxHash,
      LA.auxAcl,
      LA.donos,
      LA.rpcHash,
      LA.varHash,
    ],
    {},
    m1,
  );
  // os donos
  const SEM_EXEC_DONO = (sig, dono) =>
    `(SELECT pg_get_userbyid(proowner) = '${dono}' FROM pg_proc WHERE oid = to_regprocedure('${sig}'))`;
  await na(
    "a-dono-da-varredura-sem-exec",
    `GRANT CREATE ON SCHEMA public TO ${P.dono}; ALTER FUNCTION ${SIG_VAR} OWNER TO ${P.dono}`,
    SEM_EXEC_DONO(SIG_VAR, P.dono),
    [LA.donos],
  );
  await na(
    "a-dono-da-rpc-sem-exec",
    `GRANT CREATE ON SCHEMA public TO ${P.dono}; ALTER FUNCTION ${SIG_RPC} OWNER TO ${P.dono}`,
    SEM_EXEC_DONO(SIG_RPC, P.dono),
    [LA.donos],
  );
  // -- a RPC
  await na("a-rpc-ausente", `DROP FUNCTION ${SIG_RPC}`, ausente(SIG_RPC), [
    ...RPC_TODAS,
    LA.donos,
  ]);
  await naCorpo("a-rpc-byte", SIG_RPC, maisUmByte, [LA.rpcHash]);
  await naCorpo("a-rpc-char", SIG_RPC, trocaUmChar, [LA.rpcHash]);
  // o estado MISTURADO: o auxiliar de 13 parametros com o corpo antigo da RPC / da varredura
  await naCorpo("a-rpc-corpo-velho", SIG_RPC, () => CORPOS.rpc9, [LA.rpcHash]);
  await naCorpo("a-var-corpo-velho", SIG_VAR, () => CORPOS.var9, [LA.varHash]);
  await na(
    "a-rpc-sobrecarga",
    `CREATE FUNCTION public.${RPC}(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    existe(`public.${RPC}(integer)`),
    [LA.rpcSobre],
  );
  await na(
    "a-rpc-invoker",
    `ALTER FUNCTION ${SIG_RPC} SECURITY INVOKER`,
    `NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('${SIG_RPC}'))`,
    [LA.rpcForma],
  );
  await na(
    "a-rpc-sem-search-path",
    `ALTER FUNCTION ${SIG_RPC} RESET search_path`,
    `(SELECT proconfig IS NULL FROM pg_proc WHERE oid = to_regprocedure('${SIG_RPC}'))`,
    [LA.rpcForma],
  );
  for (const papel of ["PUBLIC", "anon", "service_role"])
    await na(
      `a-rpc-exec-${papel}`,
      grantExec(SIG_RPC, papel),
      temExec(SIG_RPC, papel),
      [LA.rpcAcl],
    );
  await na(
    "a-rpc-sem-exec-authenticated",
    `REVOKE EXECUTE ON FUNCTION ${SIG_RPC} FROM authenticated`,
    `NOT ${temExec(SIG_RPC, "authenticated")}`,
    [LA.rpcAcl],
  );
  // -- a varredura
  await na("a-var-ausente", `DROP FUNCTION ${SIG_VAR}`, ausente(SIG_VAR), [
    ...VAR_TODAS,
    LA.donos,
  ]);
  await naCorpo("a-var-byte", SIG_VAR, maisUmByte, [LA.varHash]);
  await naCorpo("a-var-char", SIG_VAR, trocaUmChar, [LA.varHash]);
  await na(
    "a-var-sobrecarga",
    `CREATE FUNCTION public.${VAR}(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
    existe(`public.${VAR}(integer)`),
    [LA.varSobre],
  );
  await na(
    "a-var-invoker",
    `ALTER FUNCTION ${SIG_VAR} SECURITY INVOKER`,
    `NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('${SIG_VAR}'))`,
    [LA.varForma],
  );
  await na(
    "a-var-sem-search-path",
    `ALTER FUNCTION ${SIG_VAR} RESET search_path`,
    `(SELECT proconfig IS NULL FROM pg_proc WHERE oid = to_regprocedure('${SIG_VAR}'))`,
    [LA.varForma],
  );
  for (const papel of ["PUBLIC", "anon", "authenticated"])
    await na(
      `a-var-exec-${papel}`,
      grantExec(SIG_VAR, papel),
      temExec(SIG_VAR, papel),
      [LA.varAcl],
    );
  // -- a dependencia
  await na(
    "a-dep-uso",
    `ALTER FUNCTION ${SIG_USO} RENAME TO pa_devolver_uso_cupom`,
    ausente(SIG_USO),
    [LA.depUso],
  );
  // -- o job
  const aJobAus = await na(
    "a-job-ausente",
    `${DECOY}; DELETE FROM cron.job WHERE jobname = '${JOB}'`,
    `NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = '${JOB}') AND EXISTS (SELECT 1 FROM cron.job)`,
    [LA.job],
  );
  assert.equal(linha(await rodar(aJobAus, A), LA.job).vivo, "AUSENTE");
  const aJobIna = await na(
    "a-job-inativo",
    `UPDATE cron.job SET active = false WHERE jobname = '${JOB}'`,
    `(SELECT NOT active FROM cron.job WHERE jobname = '${JOB}')`,
    [LA.job],
  );
  assert.equal(
    linha(await rodar(aJobIna, A), LA.job).vivo,
    "inativo */15 * * * *",
  );
  const aJobHor = await na(
    "a-job-horario",
    `UPDATE cron.job SET schedule = '*/5 * * * *' WHERE jobname = '${JOB}'`,
    `(SELECT schedule = '*/5 * * * *' FROM cron.job WHERE jobname = '${JOB}')`,
    [LA.job],
  );
  assert.equal(
    linha(await rodar(aJobHor, A), LA.job).vivo,
    "ativo */5 * * * *",
  );
  const aSemJobs = await na(
    "a-sem-jobs",
    SEM_JOBS_COM_RLS,
    GUARDA_SEM_JOBS_COM_RLS,
    [LA.job],
  );
  CASOS_A.push([
    "a-tabela-sem-rls-sem-jobs",
    await novo(
      "a-sem-rls-sem-jobs",
      aplicado,
      "DELETE FROM cron.job",
      `NOT EXISTS (SELECT 1 FROM cron.job) AND NOT ${GUARDA_RLS_CRON}`,
    ),
    [LA.job],
    { papel: P.cego },
  ]);
  // o job inativo e o papel cego: a limitacao declarada (NAO VERIFICAVEL passa)
  {
    const cegoInativo = await novo(
      "a-cego-inativo",
      aJobIna,
      RLS_CRON,
      GUARDA_RLS_CRON,
    );
    const rows = await rodar(cegoInativo, A, { papel: P.cego });
    await exigirPositiva(
      A,
      "16a papel cego com job inativo (limitacao declarada)",
      rows,
    );
    assert.equal(linha(rows, LA.job).vivo, NAO_VERIFICAVEL);
    const rowsSem = await rodar(aSemJobs, A, { papel: P.cego });
    await exigirPositiva(A, "16a papel cego + zero jobs", rowsSem);
    assert.equal(linha(rowsSem, LA.job).vivo, NAO_VERIFICAVEL);
  }
  for (const [rotulo, db, esperadas, opcoes] of CASOS_A)
    await negativo(A, `16a ${rotulo}`, db, esperadas, opcoes);
  {
    // o que a varredura/RPC de corpo velho diz, e o que a loja sem a 20261210 diz
    const rows = await rodar(
      CASOS_A.find((c) => c[0] === "a-rpc-corpo-velho")[1],
      A,
    );
    assert.equal(linha(rows, LA.rpcHash).vivo, HASH.rpc9.lf);
    const rows2 = await rodar(
      CASOS_A.find((c) => c[0] === "a-so-a-1209")[1],
      A,
    );
    assert.equal(
      linha(rows2, LA.auxAssin).vivo,
      "so a de 9 parametros (a 20261210000000 nao foi aplicada)",
    );
    assert.equal(linha(rows2, LA.auxHash).vivo, "AUSENTE");
    assert.equal(
      linha(
        await rodar(CASOS_A.find((c) => c[0] === "a-aux-13-e-9")[1], A),
        LA.auxAssin,
      ).vivo,
      "a de 13 e tambem a de 9 parametros",
    );
  }
  // a ida e volta: com os rollbacks aplicados a 16a reprova tudo o que o apply criou
  await negativo(A, "16a em volta (depois dos rollbacks)", volta, [
    ...FOTO_TODAS,
    ...FN_TODAS,
    ...TRG_TODAS,
    LA.auxAssin,
    LA.auxForma,
    LA.auxHash,
    LA.auxAcl,
    LA.donos,
    LA.rpcHash,
    LA.varHash,
  ]);
  ok(
    `16a NEGATIVA, UMA linha certa por defeito (${CASOS_A.length + 1} casos): a tabela da foto ausente ou com coluna a mais/tipo/NOT NULL/default/nome, sem chave primaria, sem chave estrangeira ou com NO ACTION, sem RLS, com politica ou com privilegio (tabela e coluna, para PUBLIC/anon/authenticated/service_role); a funcao da foto ausente, so OUTRA assinatura, com sobrecarga, SECURITY INVOKER, sem search_path, STABLE, corpo diferente ou EXECUTE indevido; o gatilho ausente, desligado, REPLICA, ALWAYS, BEFORE, sem OF, com mais colunas, por comando, sem WHEN, com outro WHEN ou outra funcao; a tabela de pedidos ausente; o auxiliar de 13 junto com o de 9, ausente, com corpo/forma/EXECUTE diferentes; so a 20261209 aplicada; a RPC e a varredura ausentes, com corpo velho (estado MISTURADO), forma, sobrecarga ou EXECUTE diferentes; os donos sem EXECUTE no auxiliar; devolver_uso_cupom ausente; job ausente, inativo, fora de 15 em 15, sem jobs visiveis para quem atravessa a RLS; e a loja depois dos dois rollbacks`,
  );

  // ----------------------------------------------------------- MUTANTES
  console.log(
    "\n  --- MUTANTES do texto das consultas (cada um tem de deixar um caso PASSAR) ---",
  );
  // cada linha ignorada: o primeiro caso negativo que a reprova
  async function mutanteDeCadaLinha(consulta, rol, casos) {
    let n = 0;
    for (const item of rol) {
      if (item === CONTROLE) continue;
      const caso = casos.find((c) => c[2].includes(item));
      assert.ok(caso, `nao ha negativo para a linha "${item}" (${consulta})`);
      const [, db, esperadas, opcoes] = caso;
      await mutanteTemQueSerPego(
        `${consulta.slice(0, 3)} sem a linha '${item}'`,
        consulta,
        [[textoDaLinha(consulta, item), `SELECT '${item}', 'x', 'x'`]],
        db,
        esperadas,
        opcoes,
      );
      n += 1;
    }
    return n;
  }
  const nLinhasA = await mutanteDeCadaLinha(A, CONF.ROL_DA_16A, CASOS_A);
  const nLinhasB = await mutanteDeCadaLinha(B, CONF.ROL_DA_16B, CASOS_B);
  const dbDe = (casos, rotulo) => {
    const c = casos.find((x) => x[0] === rotulo);
    assert.ok(c, `nao ha o caso ${rotulo}`);
    return c[1];
  };
  const m = (rotulo, consulta, trocas, casos, rotuloCaso) => {
    const c = casos.find((x) => x[0] === rotuloCaso);
    assert.ok(c, `nao ha o caso ${rotuloCaso}`);
    return mutanteTemQueSerPego(rotulo, consulta, trocas, c[1], c[2], c[3]);
  };
  const mLinha = (rotulo, consulta, item, de, para, casos, rotuloCaso) =>
    m(
      rotulo,
      consulta,
      trocasNaLinha(rotulo, consulta, item, de, para),
      casos,
      rotuloCaso,
    );
  // EXECUTE por papel nas linhas de ACL: anon, authenticated, service_role (funcao da foto e auxiliar).
  // PUBLIC nao tem mutante proprio: seria EQUIVALENTE, porque o EXECUTE de PUBLIC alcanca os papeis
  // nomeados (conceder a PUBLIC reprova tambem pela clausula deles; o negativo de PUBLIC roda acima).
  const CLAUSULA = {
    anon: ["CASE WHEN COALESCE(f.exec_anon, false) THEN 'anon' END", "NULL"],
    authenticated: [
      "CASE WHEN COALESCE(f.exec_auth, false) THEN 'authenticated' END",
      "NULL",
    ],
    service_role: [
      "CASE WHEN COALESCE(f.exec_service, false) THEN 'service_role' END",
      "NULL",
    ],
  };
  for (const [linhaAcl, prefixo] of [
    [LA.fnAcl, "a-fn-exec-"],
    [LA.auxAcl, "a-aux-exec-"],
  ])
    for (const papel of Object.keys(CLAUSULA))
      await mLinha(
        `16a '${linhaAcl.split(":")[0]}': EXECUTE de ${papel} ignorado`,
        A,
        linhaAcl,
        CLAUSULA[papel][0],
        CLAUSULA[papel][1],
        CASOS_A,
        `${prefixo}${papel}`,
      );
  const SIM_NAO = (campo) => `CASE WHEN f.${campo} THEN 'sim' ELSE 'nao' END`;
  const SIM_NAO_SEGURO = (campo) =>
    `COALESCE(CASE WHEN f.${campo} THEN 'sim' ELSE 'nao' END, 'papel ausente')`;
  for (const [papel, campo, seguro, para] of [
    ["anon", "exec_anon", true, "'nao'"],
    ["service_role", "exec_service", true, "'nao'"],
  ])
    await mLinha(
      `16a RPC: EXECUTE de ${papel} ignorado`,
      A,
      LA.rpcAcl,
      seguro ? SIM_NAO_SEGURO(campo) : SIM_NAO(campo),
      para,
      CASOS_A,
      `a-rpc-exec-${papel}`,
    );
  await mLinha(
    "16a RPC: authenticated sem EXECUTE ignorado",
    A,
    LA.rpcAcl,
    SIM_NAO_SEGURO("exec_auth"),
    "'sim'",
    CASOS_A,
    "a-rpc-sem-exec-authenticated",
  );
  for (const [papel, campo, seguro] of [
    ["anon", "exec_anon", true],
    ["authenticated", "exec_auth", true],
  ])
    await mLinha(
      `16a varredura: EXECUTE de ${papel} ignorado`,
      A,
      LA.varAcl,
      seguro ? SIM_NAO_SEGURO(campo) : SIM_NAO(campo),
      "'nao'",
      CASOS_A,
      `a-var-exec-${papel}`,
    );
  // os donos: cada um, e o guarda AUSENTE
  await m(
    "16a donos: so a RPC conta (o dono da varredura sem EXECUTE passa)",
    A,
    [
      [
        "d.nome IN ('vaga_do_cupom_presa', 'devolver_cupons_de_pedidos_mortos')",
        "d.nome IN ('vaga_do_cupom_presa')",
      ],
    ],
    CASOS_A,
    "a-dono-da-varredura-sem-exec",
  );
  await m(
    "16a donos: so a varredura conta (o dono da RPC sem EXECUTE passa)",
    A,
    [
      [
        "d.nome IN ('vaga_do_cupom_presa', 'devolver_cupons_de_pedidos_mortos')",
        "d.nome IN ('devolver_cupons_de_pedidos_mortos')",
      ],
    ],
    CASOS_A,
    "a-dono-da-rpc-sem-exec",
  );
  await mutanteComChecagem(
    "16a donos: sem o guarda AUSENTE (diria 'nao' em vez de AUSENTE)",
    A,
    [
      [
        "WHEN (SELECT count(*) FROM fn f\n                     WHERE f.existe AND f.nome IN ('cupom__vaga_volta_em', 'vaga_do_cupom_presa',\n                                                   'devolver_cupons_de_pedidos_mortos')) <> 3 THEN 'AUSENTE'",
        "WHEN false THEN 'AUSENTE'",
      ],
    ],
    dbDe(CASOS_A, "a-aux-ausente"),
    (rows) =>
      assert.equal(
        linha(rows, LA.donos).vivo,
        "AUSENTE",
        "sem o guarda o vivo muda",
      ),
  );
  // o job: active, horario, RLS (duas vezes) e a guarda do papel cego
  const jobItemA = LA.job;
  await m(
    "16a job: o campo active ignorado",
    A,
    [["CASE WHEN g.active THEN 'ativo ' ELSE 'inativo ' END", "'ativo '"]],
    CASOS_A,
    "a-job-inativo",
  );
  await m(
    "16a job: o horario ignorado",
    A,
    [["|| g.schedule,", "|| '*/15 * * * *',"]],
    CASOS_A,
    "a-job-horario",
  );
  const SEM_RLS = " AND (SELECT ativa FROM rls)";
  await m(
    "16a job: row_security_active ignorado (zero jobs visiveis vira NAO VERIFICAVEL para quem atravessa a RLS)",
    A,
    [
      [SEM_RLS, ""],
      [SEM_RLS, ""],
    ],
    CASOS_A,
    "a-sem-jobs",
  );
  await m(
    "16a job: row_security_active ignorado (tabela sem RLS)",
    A,
    [
      [SEM_RLS, ""],
      [SEM_RLS, ""],
    ],
    CASOS_A,
    "a-tabela-sem-rls-sem-jobs",
  );
  void jobItemA;
  await m(
    "16b job: o campo active ignorado",
    B,
    [["CASE WHEN g.active THEN 'ativo ' ELSE 'inativo ' END", "'ativo '"]],
    CASOS_B,
    "b-job-inativo",
  );
  await m(
    "16b job: o horario ignorado",
    B,
    [["|| g.schedule,", "|| '*/15 * * * *',"]],
    CASOS_B,
    "b-job-horario",
  );
  await m(
    "16b job: row_security_active ignorado (zero jobs visiveis vira NAO VERIFICAVEL para quem atravessa a RLS)",
    B,
    [
      [SEM_RLS, ""],
      [SEM_RLS, ""],
    ],
    CASOS_B,
    "b-sem-jobs",
  );
  await m(
    "16b job: row_security_active ignorado (tabela sem RLS)",
    B,
    [
      [SEM_RLS, ""],
      [SEM_RLS, ""],
    ],
    CASOS_B,
    "b-tabela-sem-rls-sem-jobs",
  );
  for (const [consulta, base, rotulo] of [
    [A, cegoA, "16a"],
    [B, cegoB, "16b"],
  ])
    await mutantePositivoTemQueSerPego(
      `${rotulo} job: a guarda do papel cego (sempre estrito)`,
      consulta,
      [
        [
          "WHEN (SELECT n FROM vis) = 0 AND (SELECT ativa FROM rls)\n              THEN 'NAO VERIFICAVEL: este papel nao ve nenhum job do cron'\n              WHEN NOT EXISTS",
          "WHEN false\n              THEN 'NAO VERIFICAVEL: este papel nao ve nenhum job do cron'\n              WHEN NOT EXISTS",
        ],
      ],
      base,
      { papel: P.cego },
    );
  // o gatilho: cada flag do momento/evento, a condicao WHEN
  await m(
    "16a gatilho: BEFORE ignorado (o gatilho BEFORE passa como AFTER)",
    A,
    [
      [
        "CASE WHEN g.tgtype & 2 = 2 THEN 'BEFORE'",
        "CASE WHEN false THEN 'BEFORE'",
      ],
    ],
    CASOS_A,
    "a-gatilho-before",
  );
  await m(
    "16a gatilho: a lista de colunas do OF ignorada",
    A,
    [
      [
        "CASE WHEN g.tgtype & 16 = 16 AND g.colunas IS NOT NULL\n                                  THEN ' OF ' || g.colunas ELSE '' END",
        "' OF status'",
      ],
    ],
    CASOS_A,
    "a-gatilho-mais-colunas",
  );
  await m(
    "16a gatilho: FOR EACH STATEMENT ignorado",
    A,
    [
      [
        "CASE WHEN g.tgtype & 1 = 1 THEN ' FOR EACH ROW' ELSE ' FOR EACH STATEMENT' END",
        "' FOR EACH ROW'",
      ],
    ],
    CASOS_A,
    "a-gatilho-por-comando",
  );
  await m(
    "16a gatilho: a condicao WHEN comparada so por existir (outro WHEN passa)",
    A,
    [
      [
        "WHEN regexp_replace(lower(g.quando), '[()[:space:]]', '', 'g')\n                                    = 'new.status=''cancelled''::textandold.statusisdistinctfrom''cancelled''::text'",
        "WHEN true",
      ],
    ],
    CASOS_A,
    "a-gatilho-outro-when",
  );
  // a tabela da foto: default e NOT NULL na forma, a chave estrangeira, os privilegios
  // Um mutante que so deixa a consulta MAIS estrita nao afrouxa nada: o que a forma deixa de medir
  // tem de sair tambem do `esperado` (o literal com as 6 colunas), senao o positivo reprova junto.
  const FORMA_ESPERADA = SQL[A].slice(
    SQL[A].indexOf("'order_id:uuid:true:,"),
    SQL[A].indexOf("now()'", SQL[A].indexOf("'order_id:uuid:true:,")) +
      "now()'".length,
  );
  assert.ok(
    FORMA_ESPERADA.startsWith("'order_id:uuid:true:,") &&
      FORMA_ESPERADA.endsWith("timestamp with time zone:true:now()'"),
    "nao achei o literal da forma esperada das colunas da foto",
  );
  await m(
    "16a colunas da foto: o default ignorado (do vivo e do esperado)",
    A,
    [
      ["COALESCE(pg_get_expr(d.adbin, d.adrelid), '')", "''"],
      [FORMA_ESPERADA, FORMA_ESPERADA.replace(":true:now()'", ":true:'")],
    ],
    CASOS_A,
    "a-coluna-sem-default",
  );
  await m(
    "16a colunas da foto: NOT NULL ignorado (do vivo e do esperado)",
    A,
    [
      ["a.attnotnull::text", "'x'"],
      [FORMA_ESPERADA, FORMA_ESPERADA.replace(/:(true|false):/g, ":x:")],
    ],
    CASOS_A,
    "a-coluna-tentativas-sem-not-null",
  );
  await m(
    "16a chave estrangeira: o ON DELETE ignorado (NO ACTION passa como CASCADE)",
    A,
    [
      [
        "CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'a' THEN 'NO ACTION'",
        "CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'a' THEN 'CASCADE'",
      ],
    ],
    CASOS_A,
    "a-fk-sem-cascade",
  );
  // (o privilegio de COLUNA de PUBLIC nao tem mutante proprio: e EQUIVALENTE, porque um privilegio de
  // PUBLIC alcanca os papeis nomeados e a linha reprova por eles; o negativo roda acima)
  await m(
    "16a privilegios da foto: o privilegio de COLUNA dos papeis nomeados ignorado",
    A,
    [
      [
        "OR CASE WHEN x.p IN ('INSERT', 'REFERENCES', 'SELECT', 'UPDATE')\n                           THEN has_any_column_privilege(q.papel::name, tab.foto, x.p)\n                           ELSE false END",
        "",
      ],
    ],
    CASOS_A,
    "a-privilegio-de-coluna-authenticated",
  );
  await m(
    "16a privilegios da foto: o privilegio de TABELA dos papeis nomeados ignorado",
    A,
    [["ELSE has_table_privilege(q.papel::name, tab.foto, x.p)", "ELSE false"]],
    CASOS_A,
    "a-privilegio-delete-anon",
  );
  // a 16b: o tipo das colunas tipadas
  await m(
    "16b colunas: o TIPO das colunas tipadas ignorado",
    B,
    [
      [
        "OR format_type(a.atttypid, a.atttypmod) = split_part(v.item, ':', 2)",
        "OR TRUE",
      ],
    ],
    CASOS_B,
    "b-coluna-tipo-texto",
  );
  // o CRLF dos hashes: cada um aceito so em LF reprova o positivo em CRLF
  for (const k of ["aux13", "rpc13", "var13", "foto"])
    await mutantePositivoTemQueSerPego(
      `16a sem aceitar o CRLF do corpo ${k}`,
      A,
      [[`'${HASH[k].crlf}'`, "'x'"]],
      aplicadocrlf,
    );
  for (const k of ["aux9", "rpc9", "var9"])
    await mutantePositivoTemQueSerPego(
      `16b sem aceitar o CRLF do corpo ${k}`,
      B,
      [[`'${HASH[k].crlf}'`, "'x'"]],
      precrlf,
    );
  ok(
    `MUTANTES do texto das consultas: cada uma das linhas ignorada (${nLinhasA} da 16a e ${nLinhasB} da 16b; a de controle fica sem mutante) e as clausulas compostas desligadas (EXECUTE por papel na funcao da foto, no auxiliar, na RPC e na varredura; cada dono; o guarda AUSENTE dos donos; active, horario, RLS e papel cego do job; BEFORE, OF, FOR EACH e WHEN do gatilho; default, NOT NULL, ON DELETE e privilegios de tabela/coluna da foto; o tipo das colunas da 16b; o CRLF dos sete hashes) deixam um caso PASSAR e a prova ficaria VERMELHA`,
  );

  // ----------------------------------------------------------- ROL FECHADO
  {
    const rows = await rodar(aplicado, A);
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
    assert.ok(veredito(A12, rows).endsWith("rol=invalido"));
    ok(
      "rol FECHADO: a resposta PARCIAL (so as linhas ok=true), com linha duplicada ou com o rol da OUTRA consulta (16a x 16b x 12a) tem rol=invalido e o portao a trata como SEM_EVIDENCIA, nunca POSITIVA",
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
  {
    // papel sem USAGE no schema cron: a consulta ERRA (nunca positivo)
    const r = await tentar(aplicado, A, { papel: P.semcron });
    assert.ok(r.erro && r.erro.code === "42501", String(r.erro));
    assert.equal(r.rows, undefined);
    const rb = await tentar(pre, B, { papel: P.semcron });
    assert.ok(rb.erro && rb.erro.code === "42501", String(rb.erro));
  }
  ok(
    "erro de SQL (42601) e papel sem USAGE no schema cron (42501) na 16a e na 16b: falha ALTA, nenhuma linha, e o portao fica SEM_EVIDENCIA mesmo com o run verde -- erro nunca vira positivo",
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
    // o run "de verdade": o log do processo filho vira a evidencia do portao
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
    assert.ok(lote, "o canais-de-backend.json real nao declara o lote da 16a");
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
        `o lote nao devia declarar ${campo}`,
      );
    /** Le as duas consultas contra `dbAlvo` pelo processo de verdade e decide o lote. */
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
        linhas: 32,
        okFalse: 0,
        naoBooleano: 0,
        rol: "ok",
      });
      const e1b = await executar(pre, B);
      assert.deepEqual(PORTAO.lerVeredicto(e1b.saida, B), {
        ref: REF_SAVY,
        sha: SHA40,
        linhas: 14,
        okFalse: 0,
        naoBooleano: 0,
        rol: "ok",
      });
      // E2: banco inexistente -> HTTP 400, saida 1, NENHUM veredito, SEM_EVIDENCIA
      const e2 = await executar("pa_banco_que_nao_existe", A);
      assert.equal(e2.codigo, 1, e2.saida);
      assert.ok(!e2.saida.includes("VEREDITO-CONSULTA"), e2.saida);
      assert.equal((await evidencia(A, e2.saida)).estado, "SEM_EVIDENCIA");
      // E3: papel sem USAGE no schema cron -> erro do banco, saida 1, NENHUM veredito
      const e3 = await executar(aplicado, A, P.semcron);
      assert.equal(e3.codigo, 1, e3.saida);
      assert.ok(!e3.saida.includes("VEREDITO-CONSULTA"), e3.saida);
      assert.equal((await evidencia(A, e3.saida)).estado, "SEM_EVIDENCIA");

      // L1: loja ANTES do apply (ledger sem as versoes): 16a NEGATIVA + 16b POSITIVA -> APLICAR as duas
      const l1 = await decidir(pre, { faltam: [V1, V2], exigeProva: true });
      assert.equal(l1.prova.estado, "NEGATIVA");
      assert.equal(l1.diag.estado, "POSITIVA");
      assert.equal(l1.decisao.acao, "APLICAR", JSON.stringify(l1.decisao));
      assert.deepEqual(l1.decisao.versoes, [V1, V2]);
      // L1b: o mesmo, com os arquivos de antes em CRLF (checkout Windows)
      const l1b = await decidir(precrlf, {
        faltam: [V1, V2],
        exigeProva: true,
      });
      assert.equal(l1b.decisao.acao, "APLICAR", JSON.stringify(l1b.decisao));
      assert.deepEqual(l1b.decisao.versoes, [V1, V2]);
      // L2: loja DEPOIS do apply, ledger com as versoes: 16a POSITIVA -> NADA
      const l2 = await decidir(aplicado, { faltam: [], exigeProva: true });
      assert.equal(l2.prova.estado, "POSITIVA");
      assert.equal(l2.decisao.acao, "NADA", JSON.stringify(l2.decisao));
      const l2b = await decidir(aplicadocrlf, { faltam: [], exigeProva: true });
      assert.equal(l2b.prova.estado, "POSITIVA");
      assert.equal(l2b.decisao.acao, "NADA", JSON.stringify(l2b.decisao));
      // L3: objetos no banco mas o ledger SEM as versoes e sem backfillLedger -> PARAR, nenhum apply
      const l3 = await decidir(aplicado, {
        faltam: [V1, V2],
        exigeProva: true,
      });
      assert.equal(l3.prova.estado, "POSITIVA");
      assert.equal(l3.decisao.acao, "PARAR", JSON.stringify(l3.decisao));
      assert.match(l3.decisao.motivo, /não declara backfillLedger/);
      // L4: so a 20261209 aplicada (a 20261210 falhou): ledger sem a segunda, 16a e 16b negativas -> PARAR
      const l4 = await decidir(m1, { faltam: [V2], exigeProva: true });
      assert.equal(l4.prova.estado, "NEGATIVA");
      assert.equal(l4.diag.estado, "NEGATIVA");
      assert.equal(l4.decisao.acao, "PARAR", JSON.stringify(l4.decisao));
      assert.ok(!l4.decisao.versoes, "PARAR nao carrega versoes a aplicar");
      // L4b: o mesmo banco com o ledger SEM as duas -> PARAR (nunca reaplica a foto)
      const l4b = await decidir(m1, { faltam: [V1, V2], exigeProva: true });
      assert.equal(l4b.decisao.acao, "PARAR", JSON.stringify(l4b.decisao));
      // L5: ledger com as versoes mas o banco de volta (rollback manual feito): 16a NEGATIVA -> PARAR
      const l5 = await decidir(volta, { faltam: [], exigeProva: true });
      assert.equal(l5.prova.estado, "NEGATIVA");
      assert.equal(l5.decisao.acao, "PARAR", JSON.stringify(l5.decisao));
      // L5b: o banco de volta com o ledger SEM as versoes volta a ser o de antes: APLICAR de novo
      const l5b = await decidir(volta, { faltam: [V1, V2], exigeProva: true });
      assert.equal(l5b.diag.estado, "POSITIVA");
      assert.equal(l5b.decisao.acao, "APLICAR", JSON.stringify(l5b.decisao));
      // L6: ledger sem as versoes, 16a NEGATIVA, mas a 16b NEGATIVA (o gatilho ja existe) -> PARAR
      const l6 = await decidir(dbDe(CASOS_B, "b-gatilho"), {
        faltam: [V1, V2],
        exigeProva: true,
      });
      assert.equal(l6.prova.estado, "NEGATIVA");
      assert.equal(l6.diag.estado, "NEGATIVA");
      assert.equal(l6.decisao.acao, "PARAR", JSON.stringify(l6.decisao));
      // L7: a varredura de antes com outro corpo (16b negativa) -> PARAR, nenhum apply
      const l7 = await decidir(dbDe(CASOS_B, "b-var-970"), {
        faltam: [V1, V2],
        exigeProva: true,
      });
      assert.equal(l7.diag.estado, "NEGATIVA");
      assert.equal(l7.decisao.acao, "PARAR", JSON.stringify(l7.decisao));
      // L8: ledger completo mas o estado MISTURADO (RPC de corpo velho): 16a NEGATIVA -> PARAR
      const l8 = await decidir(dbDe(CASOS_A, "a-rpc-corpo-velho"), {
        faltam: [],
        exigeProva: true,
      });
      assert.equal(l8.prova.estado, "NEGATIVA");
      assert.equal(l8.decisao.acao, "PARAR", JSON.stringify(l8.decisao));
      // L9: gatilho desligado depois do apply (a foto deixaria de ser gravada): 16a NEGATIVA -> PARAR
      const l9 = await decidir(dbDe(CASOS_A, "a-gatilho-desligado"), {
        faltam: [],
        exigeProva: true,
      });
      assert.equal(l9.prova.estado, "NEGATIVA");
      assert.equal(l9.decisao.acao, "PARAR", JSON.stringify(l9.decisao));
      // L10: o lote 12 na mesma loja depois do 16: a 12a pelo processo de verdade segue POSITIVA
      const e12 = await executar(aplicado, A12);
      assert.equal(e12.codigo, 0, e12.saida);
      assert.deepEqual(PORTAO.lerVeredicto(e12.saida, A12), {
        ref: REF_SAVY,
        sha: SHA40,
        linhas: 24,
        okFalse: 0,
        naoBooleano: 0,
        rol: "ok",
      });
      assert.equal((await evidencia(A12, e12.saida)).estado, "POSITIVA");
      ok(
        "ponta a ponta (conferir-banco.cjs de verdade, HTTP local, papel de leitura, canais-de-backend.json REAL): ANTES do apply 16a NEGATIVA + 16b POSITIVA -> APLICAR [20261209000000, 20261210000000] em ordem (tambem com os arquivos de antes em CRLF e com o banco de VOLTA); depois do apply 16a POSITIVA -> NADA (LF e CRLF); objetos sem as versoes no ledger -> PARAR (sem backfill, sem apply); so a 20261209 aplicada -> PARAR (com o ledger sem a segunda ou sem as duas); ledger completo com o banco de volta, com a RPC de corpo velho ou com o gatilho desligado -> PARAR; 16b negativa (gatilho ja existe, varredura de outro corpo) -> PARAR; a 12a do cupom preso segue POSITIVA no estado que o lote deixa; banco inexistente e papel sem USAGE em cron -> saida 1, sem veredito, SEM_EVIDENCIA",
      );
    } finally {
      await api.parar();
    }
  }

  console.log(`\n[cupom-pix-anulado-portao-viva] ${resultados} provas ok`);
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

// `falhar` fica importado para o caso de a trava de efemero recusar antes.
void falhar;
