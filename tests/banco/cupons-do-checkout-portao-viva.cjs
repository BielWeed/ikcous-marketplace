"use strict";

/**
 * Prova VIVA das duas consultas do PORTÃO DA RELEASE para a migration
 * 20261208000000 (o checkout mostra os cupons da cliente), num Postgres EFÊMERO
 * local — nada de rede, nada de loja:
 *   15a-conferir-cupons-do-checkout-aplicado.sql        (DEPOIS do apply: 37 linhas)
 *   15b-antes-cupons-do-checkout-pecas-ausentes.sql     (ANTES do apply: 15 linhas)
 * Elas são a "prova de objetos" do lote 20261208000000 em
 * scripts/frota/canais-de-backend.json: sem elas o portão
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration
 * nova. Esta prova diz que cada consulta DECIDE certo — não que a IKCOUS ou a
 * Savy estão no estado A ou B (isso só o run da consulta contra o ref de cada
 * loja diz).
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
 *   cheio       a árvore inteira de migrations (com a 20261208000000);
 *   pre         a árvore SEM a 20261208000000 (o estado de uma loja antes do apply);
 *   aplicado    `pre` + o ARQUIVO da migration aplicado de verdade (LF);
 *   crlf        `pre` + o arquivo da migration com fim de linha CRLF (checkout Windows);
 *   basecrlf    `pre` com o corpo da validate_coupon_secure_v2 da 203 em CRLF;
 *   volta       `cheio` + o ROLLBACK manual aplicado (ida e volta);
 *   reaplicado  `volta` + a migration de novo (ida, volta e ida).
 *
 * CASOS (cada um com a LINHA exata que reprova; o veredito real, com rol=ok e o
 * ok_false esperado, é conferido em TODO caso):
 *  POSITIVOS  15b em `pre` (também com o baseline em CRLF); 15a em `cheio`, em
 *             `aplicado` (IGUAL linha a linha ao `cheio`), em `crlf` (os cinco corpos
 *             em CRLF, hashes CRLF aceitos) e em `reaplicado`; 15b em `volta`; ambas
 *             com o papel mínimo, com search_path trocado (inclusive só pg_catalog:
 *             o Postgres imprime `public.` na regra da política) e com objetos-isca
 *             de mesmo nome em outro schema; com cupons, clientes e lista GRAVADOS
 *             (a resposta não muda e não traz dado de pessoa nem de cupom).
 *  15a        A1..A5 coluna `alcance` (ausente, default errado, aceita NULL, sem
 *             default, outro tipo); A6..A9 o CHECK (ausente, valor a mais, NOT VALID,
 *             liberado); T1..T17 a tabela `cupom_clientes` (ausente, coluna a mais,
 *             tipo, RLS desligada, política extra, política com outro nome, regra com
 *             `is_admin()` ou `true`, política FOR ALL, política para PUBLIC, escrita
 *             para authenticated, escrita por COLUNA, leitura para anon e PUBLIC); F*
 *             as 5 funções, cada uma com corpo +1 byte, SECURITY INVOKER, sem
 *             search_path, volatilidade trocada, sobrecarga extra, EXECUTE para PUBLIC,
 *             EXECUTE trocado por papel e função ausente; G* o gatilho (ausente,
 *             desabilitado, ALWAYS, REPLICA, sem WHEN, WHEN a mais, evento, outra
 *             função, depois do gatilho da chave, ordem trocada); I* o índice único.
 *  15b        B* gatilho da 203 ausente/desabilitado/evento; índice; corpo da validação
 *             (+1 byte, baseline, corpo NOVO sem as peças = meia migration, sobrecarga,
 *             ausente); coluna ou função do admin atual ausente; cada peça nova SOLTA
 *             (a migration pela metade) e com sobrecarga alheia; a 15b na árvore inteira
 *             e depois do apply reprova EXATAMENTE as peças que já existem.
 *  MUTANTES   cada cláusula das consultas, desligada no texto do .sql, deixa um
 *             negativo PASSAR e esta prova ficaria VERMELHA.
 *  FECHADO    resposta PARCIAL (só as linhas ok), linha duplicada e o rol da OUTRA
 *             consulta têm rol=invalido: o portão NUNCA as trata como positivas.
 *  ERRO       SQL truncado (42601) e banco inexistente: falha ALTA, nenhuma linha
 *             VEREDITO-CONSULTA, o portão fica SEM_EVIDENCIA mesmo com o run verde.
 *  PONTA A PONTA  conferir-banco.cjs de verdade (processo filho, HTTP local) e o
 *             LOTE do canais-de-backend.json REAL no `decidirLote`: ledger sem a
 *             versão + 15a NEGATIVA + 15b POSITIVA → APLICAR (também depois de
 *             rollback); 15a POSITIVA → PARAR (sem backfillLedger); ledger com a
 *             versão + 15a POSITIVA → NADA; as duas NEGATIVAS (gatilho da 203
 *             ausente, meia migration) → PARAR.
 *
 * Toda mutação (de objeto, papel ou tabela) leva uma GUARDA que dá RAISE se não
 * aplicou: sem ela, um mutante que não aplica nada vira falso verde. Papéis
 * temporários com nome único, limpos no `finally`.
 *
 * LIMITE DECLARADO: o Postgres é o 17 LOCAL; o papel de leitura real da loja
 * (supabase_read_only_user), o Postgres 15/17 da Supabase e a ACL real das lojas
 * não foram medidos aqui; os papéis `anon` e `authenticated` existem (os cria o
 * provisionar.cjs): a linha "papel ausente" das consultas não tem negativo local.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/cupons-do-checkout-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vêm do próprio repositório (a pasta de consultas, as migrations e o
 * publicar-release.mjs), nunca de entrada de rede; as chaves de objeto vêm de
 * constantes e mapas fechados deste arquivo (nomes das consultas, das linhas e dos
 * bancos de teste), nunca de entrada externa. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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

const A = "15a-conferir-cupons-do-checkout-aplicado";
const B = "15b-antes-cupons-do-checkout-pecas-ausentes";
const VERSAO = "20261208000000";
const ARQUIVO = "20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql";
const ARQ_ROLLBACK = `rollback-manual-${ARQUIVO}`;
const ARQ_203 = "20261203000000_cupons_desligados_nao_dao_desconto.sql";
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const SHA40 = "d".repeat(40);
const SQL = {
  [A]: fs.readFileSync(path.join(CONSULTAS, `${A}.sql`), "utf8"),
  [B]: fs.readFileSync(path.join(CONSULTAS, `${B}.sql`), "utf8"),
};
const ROL = { [A]: CONF.ROL_DA_15A, [B]: CONF.ROL_DA_15B };
const N_LINHAS = { [A]: 37, [B]: 15 };

// ---------------------------------------------------------------------------
// Os hashes, RECALCULADOS dos arquivos de migration desta árvore (LF e CRLF)
// ---------------------------------------------------------------------------
const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const crlfDe = (s) => s.replace(/\n/g, "\r\n");
const lerLF = (arq) =>
  fs.readFileSync(path.join(MIGRATIONS, arq), "utf8").replace(/\r\n/g, "\n");
/** O texto entre `AS $tag$` e `$tag$;` da função cuja assinatura abre o CREATE OR REPLACE. */
function corpoDoArquivo(texto, assinatura, tag) {
  const ini = texto.indexOf(`CREATE OR REPLACE FUNCTION ${assinatura}`);
  assert.ok(ini >= 0, `não achei ${assinatura}`);
  const abre = texto.indexOf(`AS $${tag}$`, ini);
  const comeco = abre + `AS $${tag}$`.length;
  const fim = texto.indexOf(`$${tag}$;`, comeco);
  assert.ok(abre > ini && fim > comeco, `não achei o corpo de ${assinatura}`);
  return texto.slice(comeco, fim);
}
const M208 = lerLF(ARQUIVO);
const M203 = lerLF(ARQ_203);
const CORPOS = {
  lista: corpoDoArquivo(
    M208,
    "public.cupons_do_checkout(p_subtotal numeric)",
    "lista",
  ),
  ler: corpoDoArquivo(
    M208,
    "public.admin_cupom_clientes(p_coupon_id uuid)",
    "ler",
  ),
  definir: corpoDoArquivo(
    M208,
    "public.admin_cupom_definir_clientes(",
    "definir",
  ),
  gat: corpoDoArquivo(
    M208,
    "public.pedido_com_cupom_so_nasce_para_a_lista()",
    "gatilho",
  ),
  val: corpoDoArquivo(
    M208,
    "public.validate_coupon_secure_v2(p_code text, p_subtotal numeric)",
    "",
  ),
};
const CORPO_203 = corpoDoArquivo(
  M203,
  "public.validate_coupon_secure_v2(p_code text, p_subtotal numeric)",
  "",
);
const H = Object.fromEntries(
  Object.entries(CORPOS).map(([k, c]) => [
    k,
    { lf: sha(c), crlf: sha(crlfDe(c)) },
  ]),
);
const H203 = { lf: sha(CORPO_203), crlf: sha(crlfDe(CORPO_203)) };
// Os hashes que o brief da fase B fixou para a validação (conferidos aqui contra o arquivo)
assert.equal(
  H.val.lf,
  "c33e930ca389b3568bd256f9363ace8fd3935f0ac73851441e0684a374b11037",
);
assert.equal(
  H.val.crlf,
  "fdfacc20cc3bc2a691ad8961c525e5cb77071b7d5e9e590a7470e45690a2df3a",
);
assert.equal(
  H203.lf,
  "489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3",
);
assert.equal(
  H203.crlf,
  "4b096e67be79665d70e86ff5e94953ecf5842cd64abca882abac0f6cbe328279",
);
const HASH_DE = (sig) =>
  `(SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = to_regprocedure('${sig}'))`;

// ---------------------------------------------------------------------------
// Os objetos e os nomes das linhas (o rol fechado do código tem os mesmos)
// ---------------------------------------------------------------------------
const GAT_NOVO = "tr_pedido_com_cupom_so_nasce_para_a_lista";
const GAT_203 = "tr_pedido_com_cupom_exige_a_chave_ligada";
const INDICE = "marketplace_orders_chave_da_compra_unica";
const POLITICA = "cupom_clientes_admin_select_policy";
const FNS = [
  {
    k: "lista",
    nome: "cupons_do_checkout",
    args: "numeric",
    volat: "s",
    anon: true,
    auth: true,
  },
  {
    k: "ler",
    nome: "admin_cupom_clientes",
    args: "uuid",
    volat: "s",
    anon: false,
    auth: true,
  },
  {
    k: "definir",
    nome: "admin_cupom_definir_clientes",
    args: "uuid, uuid[]",
    volat: "v",
    anon: false,
    auth: true,
  },
  {
    k: "gat",
    nome: "pedido_com_cupom_so_nasce_para_a_lista",
    args: "",
    volat: "v",
    anon: false,
    auth: false,
  },
  {
    k: "val",
    nome: "validate_coupon_secure_v2",
    args: "text, numeric",
    volat: "v",
    anon: null,
    auth: true,
  },
];
const FN = Object.fromEntries(FNS.map((f) => [f.k, f]));
const sigDe = (f) => `public.${f.nome}(${f.args})`;

const TG = `gatilho ${GAT_NOVO}`;
const L = {
  controle: "controle: funcoes de public visiveis a este papel",
  alcCol: "coupons.alcance: coluna (tipo, NOT NULL, default)",
  alcCk: "coupons.alcance: CHECK coupons_alcance_check",
  ccCols: "cupom_clientes: colunas",
  ccRls: "cupom_clientes: seguranca por linha (RLS) ligada",
  ccPols: "cupom_clientes: politicas (nome, comando, papeis)",
  ccRegra: "cupom_clientes: regra da politica de leitura",
  ccAuth: "cupom_clientes: privilegios de authenticated",
  ccAnon: "cupom_clientes: privilegios de anon",
  ccPub: "cupom_clientes: privilegios de PUBLIC",
  gExiste: `${TG}: existe em marketplace_orders`,
  gEvento: `${TG}: momento e evento`,
  gHab: `${TG}: habilitado`,
  gWhen: `${TG}: condicao WHEN`,
  gFn: `${TG}: funcao executada`,
  gOrdem: "gatilhos de cupom no pedido: ordem de disparo",
  iDef: `indice ${INDICE}: definicao`,
};
for (const f of FNS) {
  L[`${f.k}Sobre`] = `${f.nome}: sobrecargas`;
  L[`${f.k}Forma`] = `${f.nome}: forma`;
  L[`${f.k}Hash`] = `${f.nome}: corpo (sha256)`;
  L[`${f.k}Exec`] = `${f.nome}: EXECUTE`;
}
const LB = {
  controle: L.controle,
  colunas: "colunas que as pecas da migration leem: existem",
  admins: "is_admin, is_admin_atual e rls_admin_atual: existem",
  gate203: `gatilho ${GAT_203}: ativo (BEFORE INSERT)`,
  iDef: L.iDef,
  vSobre: "validate_coupon_secure_v2: sobrecargas",
  vHash: "validate_coupon_secure_v2: corpo e o da 20261203000000 (sha256)",
  alcance: "coupons.alcance: coluna",
  ck: "coupons_alcance_check: constraint",
  tabela: "cupom_clientes: tabela",
  lista: "cupons_do_checkout: funcao",
  ler: "admin_cupom_clientes: funcao",
  definir: "admin_cupom_definir_clientes: funcao",
  gatFn: "pedido_com_cupom_so_nasce_para_a_lista: funcao",
  trig: `${TG}: ausente em marketplace_orders`,
};
const ordena = (l) => [...l].sort();
// Tudo que a 15b exige ausente (as 8 linhas das peças novas) e o que muda no corpo da validação
const LB_PECAS = [
  LB.alcance,
  LB.ck,
  LB.tabela,
  LB.lista,
  LB.ler,
  LB.definir,
  LB.gatFn,
  LB.trig,
];
// Os rows de cada função, na ordem do rol
const linhasDa = (f) => [
  L[`${f.k}Sobre`],
  L[`${f.k}Forma`],
  L[`${f.k}Hash`],
  L[`${f.k}Exec`],
];

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
/** Roda o ROLLBACK manual (um arquivo só, numa consulta só = uma transação implícita). */
async function aplicarRollback(db) {
  const texto = fs.readFileSync(path.join(MIGRATIONS, ARQ_ROLLBACK), "utf8");
  await usar(db, (c) => c.query(texto));
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

/** Aplica uma troca ao texto da consulta. `[item, de, para]` troca DENTRO do bloco da
 * linha `item` (do `SELECT 'item',` até o próximo `UNION ALL`); `[de, para]` troca na
 * primeira ocorrência do texto todo. Falha se o trecho não existe ou nada mudou. */
function aplicarTroca(sql, troca, rotulo) {
  const [item, de, para] = troca.length === 3 ? troca : [null, ...troca];
  let ini = 0;
  let fim = sql.length;
  if (item) {
    ini = sql.indexOf(`SELECT '${item}',`);
    assert.ok(ini >= 0, `${rotulo}: a linha "${item}" não existe no .sql`);
    const prox = sql.indexOf("\n  UNION ALL", ini);
    const ultimo = sql.indexOf("\n)\nSELECT item", ini);
    fim = prox >= 0 && prox < ultimo ? prox : ultimo;
  }
  const bloco = sql.slice(ini, fim);
  assert.ok(
    bloco.includes(de),
    `${rotulo}: o trecho a mutar não existe: ${de}`,
  );
  const novo = bloco.replace(de, () => para);
  assert.notEqual(novo, bloco, `${rotulo}: a troca não mudou nada`);
  return sql.slice(0, ini) + novo + sql.slice(fim);
}
/** Um MUTANTE do texto do .sql tem de ser PEGO: com ele, o negativo `db` deixa de
 * reprovar o que devia e `exigirReprovadas` LANÇA — a prova ficaria vermelha. */
async function mutanteTemQueSerPego(rotulo, consulta, trocas, db, esperadas) {
  let sql = SQL[consulta];
  for (const troca of trocas) sql = aplicarTroca(sql, troca, rotulo);
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
    ordena(CONF.ROL_DA_15A),
    ordena(Object.values(L)),
    "o rol da 15a do código é o conjunto de itens que esta prova conhece",
  );
  assert.deepEqual(
    ordena(CONF.ROL_DA_15B),
    ordena(Object.values(LB)),
    "o rol da 15b do código é o conjunto de itens que esta prova conhece",
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
          [GAT_NOVO],
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
      "precondição: a árvore inteira tem o gatilho novo",
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
    // os hashes literais das consultas são os recalculados dos arquivos desta árvore
    const hexA = [...SQL[A].matchAll(/'([0-9a-f]{64})'/g)].map((m) => m[1]);
    assert.deepEqual(
      [...new Set(hexA)].sort(),
      Object.values(H)
        .flatMap((x) => [x.lf, x.crlf])
        .sort(),
    );
    const hexB = [...SQL[B].matchAll(/'([0-9a-f]{64})'/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(hexB)].sort(), [H203.lf, H203.crlf].sort());
    ok(
      "precondição: banco migrado com a árvore inteira (gatilho novo presente), vazio, conexão superusuário; os hashes literais da 15a (10) e da 15b (2) são os recalculados dos arquivos de migration desta árvore",
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
          [GAT_NOVO],
        )
      ).rows[0].n,
      coluna: (
        await c.query(
          "SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.coupons'::regclass AND attname = 'alcance' AND NOT attisdropped",
        )
      ).rows[0].n,
      tabela: (
        await c.query(
          "SELECT to_regclass('public.cupom_clientes') IS NOT NULL AS e",
        )
      ).rows[0].e,
      hash: (await c.query(`SELECT ${HASH_DE(sigDe(FN.val))} AS h`)).rows[0].h,
    }));
    assert.deepEqual(sonda, {
      gatilho: 0,
      coluna: 0,
      tabela: false,
      hash: H203.lf,
    });
  }
  const aplicado = await clonar("aplicado", pre);
  aplicarMigration(aplicado);
  const crlf = await clonar("crlf", pre);
  aplicarMigration(crlf, { crlf: true });
  const baseCrlf = await clonar("basecrlf", pre);
  await reescreverCorpo(baseCrlf, sigDe(FN.val), (c) =>
    c.replace(/\n/g, "\r\n"),
  );
  await mutar(
    baseCrlf,
    "baseline em CRLF",
    "SELECT 1",
    `${HASH_DE(sigDe(FN.val))} = '${H203.crlf}'`,
  );
  const volta = await clonar("volta", cheio);
  await aplicarRollback(volta);
  const reaplicado = await clonar("reaplicado", volta);
  aplicarMigration(reaplicado);
  ok(
    "bases montadas: cheio (árvore inteira), pre (sem a 20261208000000: sem coluna, tabela, funções nem gatilho; validação com o corpo da 203), aplicado (pre + o ARQUIVO aplicado, LF), crlf (idem, CRLF), baseCrlf (pre com a validação da 203 em CRLF), volta (cheio + rollback manual) e reaplicado (volta + a migration de novo)",
  );

  // ----------------------------------------------------------- POSITIVOS
  const rowsCheio = await rodar(cheio, A);
  await exigirPositiva(A, "15a em cheio", rowsCheio);
  {
    const rowsAplicado = await rodar(aplicado, A);
    await exigirPositiva(A, "15a em aplicado", rowsAplicado);
    assert.deepEqual(
      rowsAplicado,
      rowsCheio,
      "o apply isolado do ARQUIVO sobre a base pré é indistinguível da árvore inteira",
    );
    const rowsCrlf = await rodar(crlf, A);
    await exigirPositiva(A, "15a em crlf", rowsCrlf);
    await usar(crlf, async (c) => {
      for (const f of FNS) {
        const h = (await c.query(`SELECT ${HASH_DE(sigDe(f))} AS h`)).rows[0].h;
        assert.equal(
          h,
          H[f.k].crlf,
          `guarda: o corpo de ${f.nome} ficou em CRLF`,
        );
        // o que a linha MOSTRA é o hash LF (o `esperado`): o CRLF é aceito, não exibido
        assert.equal(linha(rowsCrlf, L[`${f.k}Hash`]).vivo, H[f.k].lf);
      }
    });
    const rowsRe = await rodar(reaplicado, A);
    await exigirPositiva(A, "15a em reaplicado", rowsRe);
    assert.deepEqual(
      rowsRe,
      rowsCheio,
      "ida, volta e ida: o banco reaplicado é indistinguível do primeiro apply",
    );
    ok(
      "15a POSITIVA (37 linhas, rol=ok, portão POSITIVA) na árvore inteira, no ARQUIVO aplicado sobre a base pré (resposta IDÊNTICA linha a linha), em CRLF (os cinco corpos gravados em CRLF, hashes CRLF aceitos e o LF exibido) e depois de ida, volta (rollback manual) e ida de novo (resposta idêntica)",
    );
  }
  {
    const rows = await rodar(pre, B);
    await exigirPositiva(B, "15b em pre", rows);
    assert.equal(linha(rows, LB.vHash).vivo, H203.lf);
    await exigirPositiva(B, "15b em baseline CRLF", await rodar(baseCrlf, B));
    // depois do rollback manual a loja volta à base de antes: a 15b volta a ser positiva
    const rowsVolta = await rodar(volta, B);
    await exigirPositiva(B, "15b em volta (depois do rollback)", rowsVolta);
    assert.deepEqual(
      rowsVolta,
      rows,
      "depois do rollback a 15b responde como na base pré",
    );
    ok(
      "15b POSITIVA (15 linhas, rol=ok, portão POSITIVA) na base SEM a migration, também com o corpo da validação em CRLF e DEPOIS do rollback manual (resposta idêntica à da base pré: o rollback devolve a 203 byte a byte e apaga tudo que a migration criou)",
    );
  }
  {
    // outro papel e outro search_path: as consultas só leem catálogo e nomeiam tudo
    // com `public.`; objetos-isca de mesmo nome em outro schema não mudam nada.
    const isca = `CREATE SCHEMA pv_isca;
       CREATE TABLE pv_isca.marketplace_orders (id int, coupon_id int);
       CREATE TABLE pv_isca.coupons (id int, alcance text);
       CREATE TABLE pv_isca.cupom_clientes (coupon_id int);
       CREATE FUNCTION pv_isca.validate_coupon_secure_v2(p_code text, p_subtotal numeric) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
       CREATE FUNCTION pv_isca.cupons_do_checkout(p_subtotal numeric) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
       CREATE FUNCTION pv_isca.admin_cupom_clientes(p_coupon_id uuid) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
       CREATE FUNCTION pv_isca.pedido_com_cupom_so_nasce_para_a_lista() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
       CREATE FUNCTION pv_isca.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
       GRANT USAGE ON SCHEMA pv_isca TO PUBLIC`;
    const guardaIsca = "to_regclass('pv_isca.cupom_clientes') IS NOT NULL";
    const iscas = await clonar("iscas", aplicado);
    await mutar(iscas, "schema de iscas", isca, guardaIsca);
    for (const [papel, antes, rotulo] of [
      [P.minimo, [], "papel mínimo (sem BYPASSRLS nem pg_read_all_data)"],
      [
        P.ro,
        ["SET search_path = pv_isca, pg_catalog"],
        "search_path com as iscas à frente",
      ],
      [
        P.ro,
        ["SET search_path = pg_catalog"],
        "search_path só pg_catalog (a regra da política sai com `public.`)",
      ],
      [P.ro, ["SET search_path = ''"], "search_path vazio"],
    ]) {
      await exigirPositiva(
        A,
        `15a ${rotulo}`,
        await rodar(iscas, A, { papel, antes }),
      );
    }
    const preIscas = await clonar("preiscas", pre);
    await mutar(preIscas, "iscas no pre", isca, guardaIsca);
    await exigirPositiva(
      B,
      "15b papel mínimo",
      await rodar(pre, B, { papel: P.minimo }),
    );
    await exigirPositiva(
      B,
      "15b com iscas à frente do search_path",
      await rodar(preIscas, B, {
        antes: ["SET search_path = pv_isca, pg_catalog"],
      }),
    );
    await exigirPositiva(
      B,
      "15b search_path vazio",
      await rodar(pre, B, { antes: ["SET search_path = ''"] }),
    );
    ok(
      "15a e 15b POSITIVAS também com o papel mínimo, com search_path trocado (iscas à frente, só pg_catalog e vazio) e com objetos-isca de mesmo nome em outro schema (tudo é nomeado com public.)",
    );
  }
  {
    // A consulta só lê catálogo: com cupons, clientes e lista GRAVADOS a resposta é a mesma
    // e nenhuma linha traz e-mail, código de cupom nem id de pessoa.
    const comDados = await clonar("comdados", cheio);
    await usar(comDados, async (c) => {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
           ('c0c80000-0000-4000-8000-0000000000d1', 'cliente.portao@cupons208.teste', '{}'::jsonb)`,
      );
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role)
         VALUES ('c0c80000-0000-4000-8000-0000000000d1', 'Cliente Portao', 'customer')`,
      );
      const r = await c.query(
        `INSERT INTO public.coupons (code, type, value, active, alcance) VALUES
           ('PORTAOVIT', 'percentage', 10, true, 'vitrine'),
           ('PORTAOEXC', 'fixed', 5, true, 'exclusivo'),
           ('PORTAOSEC', 'fixed', 3, true, 'codigo') RETURNING id, code`,
      );
      const exc = r.rows.find((x) => x.code === "PORTAOEXC").id;
      await c.query(
        `INSERT INTO public.cupom_clientes (coupon_id, user_id)
         VALUES ($1, 'c0c80000-0000-4000-8000-0000000000d1')`,
        [exc],
      );
    });
    const rows = await rodar(comDados, A);
    await exigirPositiva(A, "15a com dados gravados", rows);
    assert.deepEqual(
      rows,
      rowsCheio,
      "gravar cupom, cliente e lista não muda a resposta",
    );
    const texto = JSON.stringify([...rows, ...(await rodar(comDados, B))]);
    for (const dado of [
      "cupons208.teste",
      "Cliente Portao",
      "PORTAOVIT",
      "PORTAOEXC",
      "PORTAOSEC",
      "c0c80000",
    ])
      assert.ok(
        !texto.includes(dado),
        `a resposta não pode trazer dado de pessoa nem de cupom: ${dado}`,
      );
    ok(
      "com cupons, uma cliente e a lista GRAVADOS a 15a continua POSITIVA e IDÊNTICA, e nenhuma linha das duas consultas traz e-mail, nome, código de cupom nem id de pessoa",
    );
  }

  // ----------------------------------------------------------- 15a: NEGATIVOS
  const db = {};
  const novo = async (rotulo, sqlMut, guarda, base = cheio) => {
    const nome = await clonar(rotulo, base);
    await mutar(nome, rotulo, sqlMut, guarda);
    return nome;
  };
  const colAlc = (campo) =>
    `(SELECT ${campo} FROM pg_attribute WHERE attrelid = 'public.coupons'::regclass AND attname = 'alcance' AND NOT attisdropped)`;
  const defAlc = `(SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE a.attrelid = 'public.coupons'::regclass AND a.attname = 'alcance')`;
  const ckDef = `(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.coupons'::regclass AND conname = 'coupons_alcance_check')`;
  const SEM_COLUNA =
    "NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.coupons'::regclass AND attname = 'alcance' AND NOT attisdropped)";

  // A coluna `alcance` -------------------------------------------------------
  db.a1 = await novo(
    "a1",
    "ALTER TABLE public.coupons DROP COLUMN alcance",
    SEM_COLUNA,
  );
  await negativo(A, "A1 coluna alcance ausente (o CHECK cai junto)", db.a1, [
    L.alcCol,
    L.alcCk,
  ]);
  assert.equal(linha(await rodar(db.a1, A), L.alcCol).vivo, "AUSENTE");
  db.a2 = await novo(
    "a2",
    "ALTER TABLE public.coupons ALTER COLUMN alcance SET DEFAULT 'vitrine'",
    `${defAlc} = '''vitrine''::text'`,
  );
  await negativo(
    A,
    "A2 default 'vitrine' (todo cupom novo nasceria PÚBLICO)",
    db.a2,
    [L.alcCol],
  );
  assert.equal(
    linha(await rodar(db.a2, A), L.alcCol).vivo,
    "text NOT NULL DEFAULT 'vitrine'::text",
  );
  db.a3 = await novo(
    "a3",
    "ALTER TABLE public.coupons ALTER COLUMN alcance DROP NOT NULL",
    `${colAlc("NOT attnotnull")}`,
  );
  await negativo(A, "A3 alcance aceita NULL", db.a3, [L.alcCol]);
  db.a4 = await novo(
    "a4",
    "ALTER TABLE public.coupons ALTER COLUMN alcance DROP DEFAULT",
    `${defAlc} IS NULL`,
  );
  await negativo(A, "A4 alcance sem default", db.a4, [L.alcCol]);
  assert.equal(
    linha(await rodar(db.a4, A), L.alcCol).vivo,
    "text NOT NULL DEFAULT sem default",
  );
  db.a5 = await novo(
    "a5",
    "ALTER TABLE public.coupons ALTER COLUMN alcance TYPE varchar(20)",
    `${colAlc("atttypid::regtype::text")} = 'character varying'`,
  );
  await negativo(A, "A5 alcance varchar", db.a5, [L.alcCol]);
  // O CHECK -------------------------------------------------------------------
  db.a6 = await novo(
    "a6",
    "ALTER TABLE public.coupons DROP CONSTRAINT coupons_alcance_check",
    `${ckDef} IS NULL`,
  );
  await negativo(
    A,
    "A6 CHECK ausente (alcance aceitaria qualquer texto)",
    db.a6,
    [L.alcCk],
  );
  assert.equal(linha(await rodar(db.a6, A), L.alcCk).vivo, "AUSENTE");
  db.a7 = await novo(
    "a7",
    `ALTER TABLE public.coupons DROP CONSTRAINT coupons_alcance_check;
     ALTER TABLE public.coupons ADD CONSTRAINT coupons_alcance_check CHECK (alcance IN ('codigo', 'vitrine', 'exclusivo', 'todos'))`,
    `${ckDef} LIKE '%todos%'`,
  );
  await negativo(A, "A7 CHECK com um valor a mais", db.a7, [L.alcCk]);
  db.a8 = await novo(
    "a8",
    `ALTER TABLE public.coupons DROP CONSTRAINT coupons_alcance_check;
     ALTER TABLE public.coupons ADD CONSTRAINT coupons_alcance_check CHECK (alcance IN ('codigo', 'vitrine', 'exclusivo')) NOT VALID`,
    `(SELECT NOT convalidated FROM pg_constraint WHERE conrelid = 'public.coupons'::regclass AND conname = 'coupons_alcance_check')`,
  );
  await negativo(A, "A8 CHECK NOT VALID", db.a8, [L.alcCk]);
  assert.match(linha(await rodar(db.a8, A), L.alcCk).vivo, /NAO VALIDADO$/);
  db.a9 = await novo(
    "a9",
    `ALTER TABLE public.coupons DROP CONSTRAINT coupons_alcance_check;
     ALTER TABLE public.coupons ADD CONSTRAINT coupons_alcance_check CHECK (true)`,
    `${ckDef} = 'CHECK (true)'`,
  );
  await negativo(A, "A9 CHECK liberado (CHECK true)", db.a9, [L.alcCk]);
  ok(
    "15a reprova EXATAMENTE a linha de coupons.alcance que divergiu: coluna ausente (e o CHECK junto), default 'vitrine', aceita NULL, sem default, outro tipo, CHECK ausente, com valor a mais, NOT VALID e liberado — o portão dá NEGATIVA em todos",
  );

  // A tabela cupom_clientes ---------------------------------------------------
  const POLS = `(SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cupom_clientes')`;
  const privTab = (papel, p) =>
    `has_table_privilege('${papel}', 'public.cupom_clientes', '${p}')`;
  const REGRA_DE_LEITURA = "(SELECT public.rls_admin_atual())";
  const recriarPolitica = (ate, usando, extra = "") =>
    `DROP POLICY ${POLITICA} ON public.cupom_clientes;
     CREATE POLICY ${POLITICA} ON public.cupom_clientes ${ate} USING (${usando}) ${extra}`;
  db.t1 = await novo(
    "t1",
    "DROP TABLE public.cupom_clientes",
    "to_regclass('public.cupom_clientes') IS NULL",
  );
  await negativo(
    A,
    "T1 tabela cupom_clientes ausente (as 7 linhas dela)",
    db.t1,
    [L.ccCols, L.ccRls, L.ccPols, L.ccRegra, L.ccAuth, L.ccAnon, L.ccPub],
  );
  assert.equal(linha(await rodar(db.t1, A), L.ccCols).vivo, "AUSENTE");
  db.t2 = await novo(
    "t2",
    "ALTER TABLE public.cupom_clientes ADD COLUMN extra text",
    "EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.cupom_clientes'::regclass AND attname = 'extra' AND NOT attisdropped)",
  );
  await negativo(A, "T2 coluna a mais", db.t2, [L.ccCols]);
  db.t3 = await novo(
    "t3",
    "ALTER TABLE public.cupom_clientes ALTER COLUMN criado_em TYPE timestamp",
    "(SELECT atttypid::regtype::text FROM pg_attribute WHERE attrelid = 'public.cupom_clientes'::regclass AND attname = 'criado_em') = 'timestamp without time zone'",
  );
  await negativo(A, "T3 criado_em sem fuso", db.t3, [L.ccCols]);
  db.t4 = await novo(
    "t4",
    "ALTER TABLE public.cupom_clientes ALTER COLUMN criado_em DROP NOT NULL",
    "(SELECT NOT attnotnull FROM pg_attribute WHERE attrelid = 'public.cupom_clientes'::regclass AND attname = 'criado_em')",
  );
  await negativo(A, "T4 criado_em aceita NULL", db.t4, [L.ccCols]);
  db.t5 = await novo(
    "t5",
    "ALTER TABLE public.cupom_clientes DISABLE ROW LEVEL SECURITY",
    "(SELECT NOT relrowsecurity FROM pg_class WHERE oid = 'public.cupom_clientes'::regclass)",
  );
  await negativo(A, "T5 seguranca por linha desligada", db.t5, [L.ccRls]);
  db.t6 = await novo(
    "t6",
    "CREATE POLICY pv_extra ON public.cupom_clientes FOR SELECT TO authenticated USING (true)",
    `${POLS} = 2`,
  );
  await negativo(
    A,
    "T6 politica extra permissiva (qualquer cliente leria a lista)",
    db.t6,
    [L.ccPols],
  );
  db.t7 = await novo(
    "t7",
    `ALTER POLICY ${POLITICA} ON public.cupom_clientes RENAME TO pv_outro_nome`,
    `${POLS} = 1 AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = '${POLITICA}')`,
  );
  await negativo(A, "T7 politica com outro nome", db.t7, [L.ccPols, L.ccRegra]);
  assert.equal(linha(await rodar(db.t7, A), L.ccRegra).vivo, "AUSENTE");
  db.t8 = await novo(
    "t8",
    recriarPolitica("FOR SELECT TO authenticated", "public.is_admin()"),
    `(SELECT qual FROM pg_policies WHERE policyname = '${POLITICA}') LIKE '%is_admin()%'`,
  );
  await negativo(
    A,
    "T8 regra com is_admin() (JWT velho leria a lista)",
    db.t8,
    [L.ccRegra],
  );
  db.t9 = await novo(
    "t9",
    recriarPolitica("FOR SELECT TO authenticated", "true"),
    `(SELECT qual FROM pg_policies WHERE policyname = '${POLITICA}') = 'true'`,
  );
  await negativo(A, "T9 regra true", db.t9, [L.ccRegra]);
  assert.equal(linha(await rodar(db.t9, A), L.ccRegra).vivo, "true");
  db.t10 = await novo(
    "t10",
    recriarPolitica(
      "FOR ALL TO authenticated",
      REGRA_DE_LEITURA,
      "WITH CHECK (true)",
    ),
    `(SELECT cmd FROM pg_policies WHERE policyname = '${POLITICA}') = 'ALL'`,
  );
  await negativo(A, "T10 politica FOR ALL com WITH CHECK (true)", db.t10, [
    L.ccPols,
    L.ccRegra,
  ]);
  db.t11 = await novo(
    "t11",
    recriarPolitica("FOR SELECT TO public", REGRA_DE_LEITURA),
    `(SELECT roles::text FROM pg_policies WHERE policyname = '${POLITICA}') = '{public}'`,
  );
  await negativo(A, "T11 politica para PUBLIC", db.t11, [L.ccPols]);
  db.t12 = await novo(
    "t12",
    "GRANT INSERT ON public.cupom_clientes TO authenticated",
    privTab("authenticated", "INSERT"),
  );
  await negativo(
    A,
    "T12 authenticated escreve (INSERT) direto na lista",
    db.t12,
    [L.ccAuth],
  );
  assert.equal(linha(await rodar(db.t12, A), L.ccAuth).vivo, "INSERT,SELECT");
  db.t13 = await novo(
    "t13",
    "GRANT UPDATE (user_id) ON public.cupom_clientes TO authenticated",
    "has_any_column_privilege('authenticated', 'public.cupom_clientes', 'UPDATE')",
  );
  await negativo(A, "T13 authenticated com UPDATE só numa COLUNA", db.t13, [
    L.ccAuth,
  ]);
  assert.equal(linha(await rodar(db.t13, A), L.ccAuth).vivo, "SELECT,UPDATE");
  db.t14 = await novo(
    "t14",
    "GRANT SELECT ON public.cupom_clientes TO anon",
    privTab("anon", "SELECT"),
  );
  await negativo(A, "T14 anon le a lista", db.t14, [L.ccAnon]);
  db.t15 = await novo(
    "t15",
    "GRANT SELECT (coupon_id) ON public.cupom_clientes TO anon",
    "has_any_column_privilege('anon', 'public.cupom_clientes', 'SELECT') AND NOT has_table_privilege('anon', 'public.cupom_clientes', 'SELECT')",
  );
  await negativo(A, "T15 anon le uma COLUNA da lista", db.t15, [L.ccAnon]);
  db.t16 = await novo(
    "t16",
    "GRANT SELECT ON public.cupom_clientes TO PUBLIC",
    "EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.cupom_clientes'::regclass AND a.grantee = 0)",
  );
  // PUBLIC alcança anon: as DUAS linhas reprovam (authenticated segue só com SELECT)
  await negativo(A, "T16 SELECT para PUBLIC", db.t16, [L.ccAnon, L.ccPub]);
  db.t17 = await novo(
    "t17",
    "REVOKE SELECT ON public.cupom_clientes FROM authenticated",
    `NOT ${privTab("authenticated", "SELECT")}`,
  );
  await negativo(
    A,
    "T17 authenticated sem SELECT (o painel nao leria a lista)",
    db.t17,
    [L.ccAuth],
  );
  assert.equal(linha(await rodar(db.t17, A), L.ccAuth).vivo, "nenhum");
  db.t18 = await novo(
    "t18",
    "GRANT ALL ON public.cupom_clientes TO authenticated",
    privTab("authenticated", "TRUNCATE"),
  );
  await negativo(
    A,
    "T18 authenticated com ALL (o padrao do Supabase em tabela nova)",
    db.t18,
    [L.ccAuth],
  );
  ok(
    "15a reprova EXATAMENTE a linha de cupom_clientes que divergiu: tabela ausente (as 7 linhas), coluna a mais, tipo, NOT NULL, RLS desligada, política extra, política com outro nome, regra com is_admin() ou true, FOR ALL, para PUBLIC, INSERT / UPDATE por coluna / ALL para authenticated, SELECT ou coluna para anon, SELECT para PUBLIC (anon e PUBLIC), authenticated sem SELECT",
  );

  // As 5 funções --------------------------------------------------------------
  const nSobre = (f) =>
    `(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = '${f.nome}')`;
  const campo = (f, c) =>
    `(SELECT ${c} FROM pg_proc WHERE oid = to_regprocedure('${sigDe(f)}'))`;
  const exec = (f, papel) =>
    `has_function_privilege('${papel}', to_regprocedure('${sigDe(f)}'), 'EXECUTE')`;
  const execPublic = (f) =>
    `EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = to_regprocedure('${sigDe(f)}') AND a.grantee = 0)`;
  for (const f of FNS) {
    const sig = sigDe(f);
    const [rSobre, rForma, rHash, rExec] = linhasDa(f);
    // corpo com 1 byte a mais
    db[`${f.k}Corpo`] = await novo(`${f.k}c`, "SELECT 1", "true");
    await reescreverCorpo(db[`${f.k}Corpo`], sig, (c) => `${c} `);
    await mutar(
      db[`${f.k}Corpo`],
      `${f.nome} corpo +1 byte`,
      "SELECT 1",
      `${HASH_DE(sig)} NOT IN ('${H[f.k].lf}', '${H[f.k].crlf}')`,
    );
    await negativo(
      A,
      `F ${f.nome}: corpo com 1 byte a mais`,
      db[`${f.k}Corpo`],
      [rHash],
    );
    assert.notEqual(
      linha(await rodar(db[`${f.k}Corpo`], A), rHash).vivo,
      H[f.k].lf,
    );
    // SECURITY INVOKER
    db[`${f.k}Inv`] = await novo(
      `${f.k}i`,
      `ALTER FUNCTION ${sig} SECURITY INVOKER`,
      campo(f, "NOT prosecdef"),
    );
    await negativo(A, `F ${f.nome}: SECURITY INVOKER`, db[`${f.k}Inv`], [
      rForma,
    ]);
    // sem search_path
    db[`${f.k}Sp`] = await novo(
      `${f.k}s`,
      `ALTER FUNCTION ${sig} RESET search_path`,
      campo(f, "proconfig IS NULL"),
    );
    await negativo(A, `F ${f.nome}: sem search_path`, db[`${f.k}Sp`], [rForma]);
    assert.match(
      linha(await rodar(db[`${f.k}Sp`], A), rForma).vivo,
      /sem search_path/,
    );
    // volatilidade trocada
    const outra = f.volat === "s" ? "VOLATILE" : "STABLE";
    db[`${f.k}Vol`] = await novo(
      `${f.k}v`,
      `ALTER FUNCTION ${sig} ${outra}`,
      `${campo(f, "provolatile")} = '${f.volat === "s" ? "v" : "s"}'`,
    );
    await negativo(A, `F ${f.nome}: ${outra}`, db[`${f.k}Vol`], [rForma]);
    // sobrecarga extra (o PostgREST responderia "function is not unique")
    db[`${f.k}Sob`] = await novo(
      `${f.k}o`,
      `CREATE FUNCTION public.${f.nome}(pv_extra integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$`,
      `${nSobre(f)} = 2`,
    );
    await negativo(A, `F ${f.nome}: sobrecarga extra`, db[`${f.k}Sob`], [
      rSobre,
    ]);
    // EXECUTE para PUBLIC (alcança anon e authenticated)
    db[`${f.k}Pub`] = await novo(
      `${f.k}p`,
      `GRANT EXECUTE ON FUNCTION ${sig} TO PUBLIC`,
      execPublic(f),
    );
    await negativo(A, `F ${f.nome}: EXECUTE para PUBLIC`, db[`${f.k}Pub`], [
      rExec,
    ]);
    assert.match(
      linha(await rodar(db[`${f.k}Pub`], A), rExec).vivo,
      /^PUBLIC=sim /,
    );
    // ausente (a do gatilho tem o gatilho pendurado: o caso é o do gatilho abaixo)
    if (f.k !== "gat") {
      db[`${f.k}Aus`] = await novo(
        `${f.k}a`,
        `DROP FUNCTION ${sig}`,
        `to_regprocedure('${sig}') IS NULL`,
      );
      await negativo(A, `F ${f.nome}: função ausente`, db[`${f.k}Aus`], [
        rSobre,
        rForma,
        rHash,
        rExec,
      ]);
      const rows = await rodar(db[`${f.k}Aus`], A);
      for (const r of [rForma, rHash, rExec])
        assert.equal(linha(rows, r).vivo, "AUSENTE");
      assert.equal(linha(rows, rSobre).vivo, "0");
    }
  }
  // O EXECUTE de cada função, por papel (a ACL é o que decide quem chama)
  const acl = [
    [
      "lista",
      "REVOKE EXECUTE ON FUNCTION {sig} FROM anon",
      "NOT {anon}",
      "visitante sem EXECUTE (nao veria cupom nenhum)",
    ],
    [
      "lista",
      "REVOKE EXECUTE ON FUNCTION {sig} FROM authenticated",
      "NOT {auth}",
      "authenticated sem EXECUTE",
    ],
    [
      "ler",
      "GRANT EXECUTE ON FUNCTION {sig} TO anon",
      "{anon}",
      "visitante chamaria a função do painel",
    ],
    [
      "ler",
      "REVOKE EXECUTE ON FUNCTION {sig} FROM authenticated",
      "NOT {auth}",
      "painel sem EXECUTE",
    ],
    [
      "definir",
      "GRANT EXECUTE ON FUNCTION {sig} TO anon",
      "{anon}",
      "visitante chamaria a função do painel",
    ],
    [
      "definir",
      "REVOKE EXECUTE ON FUNCTION {sig} FROM authenticated",
      "NOT {auth}",
      "painel sem EXECUTE",
    ],
    [
      "gat",
      "GRANT EXECUTE ON FUNCTION {sig} TO anon",
      "{anon}",
      "gatilho executável por anon",
    ],
    [
      "gat",
      "GRANT EXECUTE ON FUNCTION {sig} TO authenticated",
      "{auth}",
      "gatilho executável por authenticated",
    ],
    [
      "val",
      "REVOKE EXECUTE ON FUNCTION {sig} FROM authenticated",
      "NOT {auth}",
      "checkout sem EXECUTE na validação",
    ],
  ];
  let nAcl = 0;
  for (const [k, sqlModelo, guardaModelo, rotulo] of acl) {
    const f = FN[k];
    const sig = sigDe(f);
    const sub = (t) =>
      t
        .replace("{sig}", sig)
        .replace("{anon}", exec(f, "anon"))
        .replace("{auth}", exec(f, "authenticated"));
    nAcl += 1;
    const nome = await novo(`acl${nAcl}`, sub(sqlModelo), sub(guardaModelo));
    await negativo(A, `F ${f.nome}: ${rotulo}`, nome, [L[`${k}Exec`]]);
  }
  ok(
    "15a reprova EXATAMENTE a linha da função que divergiu, para cada uma das 5 (cupons_do_checkout, admin_cupom_clientes, admin_cupom_definir_clientes, a do gatilho e a validate_coupon_secure_v2): corpo com 1 byte a mais, SECURITY INVOKER, sem search_path, volatilidade trocada, sobrecarga extra, EXECUTE para PUBLIC, função ausente (as 4 linhas dela) e o EXECUTE trocado por papel (anon sem a lista, anon com o painel, authenticated sem o painel ou sem a validação, gatilho executável)",
  );

  // O gatilho novo ------------------------------------------------------------
  const trig = (campoT, nome = GAT_NOVO) =>
    `(SELECT ${campoT} FROM pg_trigger WHERE tgname = '${nome}' AND tgrelid = 'public.marketplace_orders'::regclass)`;
  const recriar = (
    clausulas,
    fn = "public.pedido_com_cupom_so_nasce_para_a_lista()",
  ) =>
    `DROP TRIGGER ${GAT_NOVO} ON public.marketplace_orders;
     CREATE TRIGGER ${GAT_NOVO} ${clausulas} EXECUTE FUNCTION ${fn}`;
  const QUANDO = "WHEN (NEW.coupon_id IS NOT NULL)";
  const FOR_ROW = "ON public.marketplace_orders FOR EACH ROW";
  const TODAS_DO_GATILHO = [
    L.gExiste,
    L.gEvento,
    L.gHab,
    L.gWhen,
    L.gFn,
    L.gOrdem,
  ];
  db.g1 = await novo(
    "g1",
    `DROP TRIGGER ${GAT_NOVO} ON public.marketplace_orders`,
    `${trig("count(*)")} = 0`,
  );
  await negativo(
    A,
    "G1 gatilho ausente (as 6 linhas dele)",
    db.g1,
    TODAS_DO_GATILHO,
  );
  {
    const r = await rodar(db.g1, A);
    for (const k of ["gExiste", "gEvento", "gHab", "gWhen", "gFn", "gOrdem"])
      assert.notEqual(linha(r, L[k]).vivo, linha(r, L[k]).esperado);
    // a função do gatilho e a validação continuam provadas: cada linha é do SEU objeto
    assert.equal(linha(r, L.gatHash).ok, true);
    assert.equal(linha(r, L.valHash).ok, true);
  }
  for (const [rotulo, comando, letra] of [
    ["g2d", "DISABLE", "D"],
    ["g2a", "ENABLE ALWAYS", "A"],
    ["g2r", "ENABLE REPLICA", "R"],
  ]) {
    db[rotulo] = await novo(
      rotulo,
      `ALTER TABLE public.marketplace_orders ${comando} TRIGGER ${GAT_NOVO}`,
      `${trig("tgenabled::text")} = '${letra}'`,
    );
    await negativo(A, `G2 ${comando}`, db[rotulo], [L.gHab]);
    assert.equal(linha(await rodar(db[rotulo], A), L.gHab).vivo, letra);
  }
  for (const [rotulo, clausula, guarda] of [
    [
      "g3a",
      `BEFORE INSERT ${FOR_ROW}`,
      `${trig("pg_get_triggerdef(oid)")} NOT LIKE '%WHEN%'`,
    ],
    [
      "g3b",
      `BEFORE INSERT ${FOR_ROW} WHEN (NEW.coupon_id IS NULL)`,
      `${trig("pg_get_triggerdef(oid)")} LIKE '%coupon_id IS NULL%'`,
    ],
    [
      "g3c",
      `BEFORE INSERT ${FOR_ROW} WHEN (NEW.coupon_id IS NOT NULL AND NEW.user_id IS NOT NULL)`,
      `${trig("pg_get_triggerdef(oid)")} LIKE '%new.user_id%'`,
    ],
  ]) {
    db[rotulo] = await novo(rotulo, recriar(clausula), guarda);
    await negativo(A, `G3 ${rotulo}`, db[rotulo], [L.gWhen]);
  }
  assert.equal(linha(await rodar(db.g3a, A), L.gWhen).vivo, "sem WHEN");
  db.g4a = await novo(
    "g4a",
    recriar(`BEFORE INSERT OR UPDATE ${FOR_ROW} ${QUANDO}`),
    `(${trig("tgtype::int")} & 16) = 16`,
  );
  await negativo(A, "G4 BEFORE INSERT OR UPDATE", db.g4a, [L.gEvento]);
  assert.equal(
    linha(await rodar(db.g4a, A), L.gEvento).vivo,
    "BEFORE INSERT OR UPDATE FOR EACH ROW",
  );
  db.g4b = await novo(
    "g4b",
    recriar(`AFTER INSERT ${FOR_ROW} ${QUANDO}`),
    `(${trig("tgtype::int")} & 2) = 0`,
  );
  // AFTER não decide o INSERT antes de ele existir: reprova o evento E a ordem (a ordem só vale BEFORE)
  await negativo(A, "G4 AFTER INSERT", db.g4b, [L.gEvento, L.gOrdem]);
  db.g4c = await novo(
    "g4c",
    `CREATE FUNCTION public.pv_outra_funcao() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RETURN NEW; END $$;
     ${recriar(`BEFORE INSERT ${FOR_ROW} ${QUANDO}`, "public.pv_outra_funcao()")}`,
    `${trig("tgfoid::regproc::text")} LIKE '%pv_outra_funcao'`,
  );
  await negativo(A, "G4 aponta para outra função", db.g4c, [L.gFn]);
  db.g4d = await novo(
    "g4d",
    recriar(`BEFORE INSERT ${FOR_ROW} ${QUANDO}`)
      .replace("FOR EACH ROW", "FOR EACH STATEMENT")
      .replace(` ${QUANDO}`, ""),
    `(${trig("tgtype::int")} & 1) = 0`,
  );
  await negativo(A, "G4 FOR EACH STATEMENT (sem WHEN)", db.g4d, [
    L.gEvento,
    L.gWhen,
  ]);
  // a ORDEM: o gatilho da chave desligada (203) tem de disparar ANTES
  db.g5 = await novo(
    "g5",
    `ALTER TRIGGER ${GAT_203} ON public.marketplace_orders RENAME TO tr_pedido_com_cupom_zz_exige`,
    `${trig("count(*)", "tr_pedido_com_cupom_zz_exige")} = 1`,
  );
  await negativo(
    A,
    "G5 o gatilho da chave passa a disparar DEPOIS do novo",
    db.g5,
    [L.gOrdem],
  );
  assert.equal(linha(await rodar(db.g5, A), L.gOrdem).vivo, GAT_NOVO);
  db.g6 = await novo(
    "g6",
    `DROP TRIGGER ${GAT_203} ON public.marketplace_orders`,
    `${trig("count(*)", GAT_203)} = 0`,
  );
  await negativo(A, "G6 o gatilho da chave (203) ausente", db.g6, [L.gOrdem]);
  ok(
    "15a reprova EXATAMENTE a linha do gatilho novo que divergiu: ausente (as 6 linhas dele), desabilitado (D), ALWAYS (A), REPLICA (R), sem WHEN / WHEN IS NULL / WHEN com condição a mais, BEFORE INSERT OR UPDATE, AFTER INSERT (evento + ordem), outra função, FOR EACH STATEMENT, e a ORDEM (o da 203 renomeado para disparar depois, e o da 203 ausente)",
  );

  // O índice único da chave de compra ----------------------------------------
  const defIdx = `pg_get_indexdef('public.${INDICE}'::regclass)`;
  db.i1 = await novo(
    "i1",
    `DROP INDEX public.${INDICE}`,
    `to_regclass('public.${INDICE}') IS NULL`,
  );
  await negativo(A, "I1 índice ausente", db.i1, [L.iDef]);
  assert.equal(linha(await rodar(db.i1, A), L.iDef).vivo, "AUSENTE");
  for (const [rotulo, def, esperado, guarda] of [
    [
      "i2",
      `CREATE UNIQUE INDEX ${INDICE} ON public.marketplace_orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
      "UNIQUE marketplace_orders (user_id,idempotency_key) WHERE idempotency_key IS NOT NULL",
      `${defIdx} LIKE '%(user_id, idempotency_key)%'`,
    ],
    [
      "i3",
      `CREATE UNIQUE INDEX ${INDICE} ON public.marketplace_orders (idempotency_key)`,
      "UNIQUE marketplace_orders (idempotency_key) WHERE sem predicado",
      `${defIdx} NOT LIKE '%WHERE%'`,
    ],
    [
      "i4",
      `CREATE INDEX ${INDICE} ON public.marketplace_orders (idempotency_key) WHERE idempotency_key IS NOT NULL`,
      "NAO UNICO marketplace_orders (idempotency_key) WHERE idempotency_key IS NOT NULL",
      `${defIdx} NOT LIKE '%UNIQUE%'`,
    ],
  ]) {
    db[rotulo] = await novo(
      rotulo,
      `DROP INDEX public.${INDICE}; ${def}`,
      guarda,
    );
    await negativo(A, `I ${rotulo}`, db[rotulo], [L.iDef]);
    assert.equal(linha(await rodar(db[rotulo], A), L.iDef).vivo, esperado);
  }
  ok(
    "15a reprova EXATAMENTE a linha do índice da chave de compra: ausente, por (user_id, chave), sem o parcial e não único — o atalho de retentativa do gatilho depende do predicado exato",
  );

  // A validação com o corpo ANTIGO (meia migration) e a 15a antes do apply -----------
  {
    const meia = await novo("meia", "SELECT 1", "true");
    await reescreverCorpo(meia, sigDe(FN.val), () => CORPO_203);
    await mutar(
      meia,
      "validação com o corpo da 203",
      "SELECT 1",
      `${HASH_DE(sigDe(FN.val))} = '${H203.lf}'`,
    );
    await negativo(
      A,
      "V1 validação ficou com o corpo da 203 (a migration parou no meio)",
      meia,
      [L.valHash],
    );
    assert.equal(linha(await rodar(meia, A), L.valHash).vivo, H203.lf);
    db.valMeia = meia;
    // a 15a ANTES do apply: reprova exatamente as peças que a migration cria
    const esperadasPre = [
      L.alcCol,
      L.alcCk,
      L.ccCols,
      L.ccRls,
      L.ccPols,
      L.ccRegra,
      L.ccAuth,
      L.ccAnon,
      L.ccPub,
      ...TODAS_DO_GATILHO,
      L.valHash,
      ...["lista", "ler", "definir", "gat"].flatMap((k) => linhasDa(FN[k])),
    ];
    assert.equal(esperadasPre.length, 32);
    await negativo(A, "A0 15a ANTES do apply", pre, esperadasPre);
    await negativo(A, "A0 15a depois do rollback manual", volta, esperadasPre);
  }
  ok(
    "15a ANTES do apply (e depois do rollback manual) reprova as 32 linhas das peças que ainda não existem (coluna e CHECK, a tabela e suas 5 linhas, o gatilho e a ordem, as 4 funções novas e o corpo da validação) e mantém verdes as 5 que já valiam (controle, índice, sobrecarga, forma e EXECUTE da validação); a validação com o corpo da 203 reprova só o corpo",
  );

  // ----------------------------------------------------------- 15b: NEGATIVOS
  const novoPre = async (rotulo, sqlMut, guarda) =>
    novo(rotulo, sqlMut, guarda, pre);
  const gate = (c) =>
    `(SELECT ${c} FROM pg_trigger WHERE tgname = '${GAT_203}' AND tgrelid = 'public.marketplace_orders'::regclass)`;
  db.b1 = await novoPre(
    "b1",
    `DROP TRIGGER ${GAT_203} ON public.marketplace_orders`,
    `${gate("count(*)")} = 0`,
  );
  await negativo(
    B,
    "B1 gatilho da 203 ausente (a #777 nao esta no banco)",
    db.b1,
    [LB.gate203],
  );
  assert.equal(linha(await rodar(db.b1, B), LB.gate203).vivo, "AUSENTE");
  db.b2 = await novoPre(
    "b2",
    `ALTER TABLE public.marketplace_orders DISABLE TRIGGER ${GAT_203}`,
    `${gate("tgenabled::text")} = 'D'`,
  );
  await negativo(B, "B2 gatilho da 203 desabilitado", db.b2, [LB.gate203]);
  assert.match(
    linha(await rodar(db.b2, B), LB.gate203).vivo,
    /^EXISTE mas nao ativo \(habilitado=D/,
  );
  db.b3 = await novoPre(
    "b3",
    `DROP TRIGGER ${GAT_203} ON public.marketplace_orders;
     CREATE TRIGGER ${GAT_203} AFTER INSERT ON public.marketplace_orders FOR EACH ROW WHEN (NEW.coupon_id IS NOT NULL) EXECUTE FUNCTION public.pedido_com_cupom_exige_a_chave_ligada()`,
    `(${gate("tgtype::int")} & 2) = 0`,
  );
  await negativo(B, "B3 gatilho da 203 AFTER (nao barra o pedido)", db.b3, [
    LB.gate203,
  ]);
  db.b4 = await novoPre(
    "b4",
    `DROP INDEX public.${INDICE}`,
    `to_regclass('public.${INDICE}') IS NULL`,
  );
  await negativo(B, "B4 índice da chave de compra ausente", db.b4, [LB.iDef]);
  db.b5 = await novoPre(
    "b5",
    `DROP INDEX public.${INDICE}; CREATE UNIQUE INDEX ${INDICE} ON public.marketplace_orders (idempotency_key)`,
    `${defIdx} NOT LIKE '%WHERE%'`,
  );
  await negativo(B, "B5 índice sem o parcial", db.b5, [LB.iDef]);
  db.b6 = await novoPre("b6", "SELECT 1", "true");
  await reescreverCorpo(db.b6, sigDe(FN.val), (c) => `${c} `);
  await mutar(
    db.b6,
    "b6 +1 byte",
    "SELECT 1",
    `${HASH_DE(sigDe(FN.val))} NOT IN ('${H203.lf}', '${H203.crlf}')`,
  );
  await negativo(
    B,
    "B6 corpo da validação com 1 byte a mais que o da 203",
    db.b6,
    [LB.vHash],
  );
  db.b7 = await novoPre("b7", "SELECT 1", "true");
  {
    const corpoNovo = await corpoDe(cheio, sigDe(FN.val));
    await reescreverCorpo(db.b7, sigDe(FN.val), () => corpoNovo);
  }
  await mutar(
    db.b7,
    "b7 corpo novo",
    "SELECT 1",
    `${HASH_DE(sigDe(FN.val))} = '${H.val.lf}'`,
  );
  await negativo(
    B,
    "B7 corpo NOVO da validação sem as peças (meia migration)",
    db.b7,
    [LB.vHash],
  );
  assert.equal(linha(await rodar(db.b7, B), LB.vHash).vivo, H.val.lf);
  db.b8 = await novoPre(
    "b8",
    `CREATE FUNCTION public.validate_coupon_secure_v2(p_code text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
    `${nSobre(FN.val)} = 2`,
  );
  await negativo(B, "B8 sobrecarga extra da validação", db.b8, [LB.vSobre]);
  db.b9 = await novoPre(
    "b9",
    `DROP FUNCTION ${sigDe(FN.val)}`,
    `to_regprocedure('${sigDe(FN.val)}') IS NULL`,
  );
  await negativo(B, "B9 validação ausente", db.b9, [LB.vHash, LB.vSobre]);
  assert.equal(linha(await rodar(db.b9, B), LB.vHash).vivo, "AUSENTE");
  db.b10 = await novoPre("b10", "SELECT 1", "true");
  {
    const corpoBase = "SELECT 1"; // qualquer corpo que não seja o da 203
    await reescreverCorpo(
      db.b10,
      sigDe(FN.val),
      () => `BEGIN RETURN '{}'::jsonb; END; -- ${corpoBase}`,
    );
  }
  await negativo(B, "B10 validação com um corpo qualquer", db.b10, [LB.vHash]);
  // colunas de que a migration depende: cada uma, renomeada, reprova SÓ a linha das colunas
  for (const [rotulo, tabela, coluna] of [
    ["b11", "coupons", "min_purchase"],
    ["b12", "coupons", "usage_count"],
    ["b13", "profiles", "full_name"],
    ["b14", "store_config", "enable_coupons"],
    ["b15", "marketplace_orders", "coupon_code"],
  ]) {
    db[rotulo] = await novoPre(
      rotulo,
      `ALTER TABLE public.${tabela} RENAME COLUMN ${coluna} TO pv_${coluna}`,
      `NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.${tabela}'::regclass AND attname = '${coluna}' AND NOT attisdropped)`,
    );
    await negativo(B, `B ${tabela}.${coluna} ausente`, db[rotulo], [
      LB.colunas,
    ]);
    assert.equal(
      linha(await rodar(db[rotulo], B), LB.colunas).vivo,
      `AUSENTES: ${tabela}.${coluna}`,
    );
  }
  // as funções do admin atual
  for (const [rotulo, f] of [
    ["b16", "is_admin"],
    ["b17", "is_admin_atual"],
    ["b18", "rls_admin_atual"],
  ]) {
    db[rotulo] = await novoPre(
      rotulo,
      `ALTER FUNCTION public.${f}() RENAME TO pv_${f}`,
      `to_regprocedure('public.${f}()') IS NULL`,
    );
    await negativo(B, `B ${f}() ausente`, db[rotulo], [LB.admins]);
    assert.equal(
      linha(await rodar(db[rotulo], B), LB.admins).vivo,
      `AUSENTES: ${f}()`,
    );
  }
  // cada peça NOVA solta = a migration pela metade
  const PECAS_SOLTAS = [
    [
      "p1",
      "coluna alcance",
      "ALTER TABLE public.coupons ADD COLUMN alcance text NOT NULL DEFAULT 'codigo'",
      SEM_COLUNA.replace("NOT EXISTS", "EXISTS"),
      [LB.alcance],
    ],
    [
      "p2",
      "coluna alcance e o CHECK",
      "ALTER TABLE public.coupons ADD COLUMN alcance text NOT NULL DEFAULT 'codigo'; ALTER TABLE public.coupons ADD CONSTRAINT coupons_alcance_check CHECK (alcance IN ('codigo', 'vitrine', 'exclusivo'))",
      `${ckDef} IS NOT NULL`,
      [LB.alcance, LB.ck],
    ],
    [
      "p3",
      "tabela cupom_clientes",
      "CREATE TABLE public.cupom_clientes (coupon_id uuid NOT NULL, user_id uuid NOT NULL, criado_em timestamptz NOT NULL DEFAULT now())",
      "to_regclass('public.cupom_clientes') IS NOT NULL",
      [LB.tabela],
    ],
    [
      "p4",
      "função cupons_do_checkout",
      "CREATE FUNCTION public.cupons_do_checkout(p_subtotal numeric) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$",
      `${nSobre(FN.lista)} = 1`,
      [LB.lista],
    ],
    [
      "p5",
      "cupons_do_checkout com a assinatura de outra pessoa",
      "CREATE FUNCTION public.cupons_do_checkout(texto text) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$",
      `${nSobre(FN.lista)} = 1`,
      [LB.lista],
    ],
    [
      "p6",
      "função admin_cupom_clientes",
      "CREATE FUNCTION public.admin_cupom_clientes(p_coupon_id uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$",
      `${nSobre(FN.ler)} = 1`,
      [LB.ler],
    ],
    [
      "p7",
      "função admin_cupom_definir_clientes",
      "CREATE FUNCTION public.admin_cupom_definir_clientes(p_coupon_id uuid, p_clientes uuid[]) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$",
      `${nSobre(FN.definir)} = 1`,
      [LB.definir],
    ],
    [
      "p8",
      "função do gatilho",
      "CREATE FUNCTION public.pedido_com_cupom_so_nasce_para_a_lista() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
      `${nSobre(FN.gat)} = 1`,
      [LB.gatFn],
    ],
    [
      "p9",
      "gatilho do exclusivo (com a função dele)",
      `CREATE FUNCTION public.pedido_com_cupom_so_nasce_para_a_lista() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
       CREATE TRIGGER ${GAT_NOVO} BEFORE INSERT ${FOR_ROW} ${QUANDO} EXECUTE FUNCTION public.pedido_com_cupom_so_nasce_para_a_lista()`,
      `${trig("count(*)")} = 1`,
      [LB.gatFn, LB.trig],
    ],
    [
      "p10",
      "gatilho do exclusivo DESABILITADO (existir, em qualquer estado, conta)",
      `CREATE FUNCTION public.pedido_com_cupom_so_nasce_para_a_lista() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
       CREATE TRIGGER ${GAT_NOVO} BEFORE INSERT ${FOR_ROW} ${QUANDO} EXECUTE FUNCTION public.pedido_com_cupom_so_nasce_para_a_lista();
       ALTER TABLE public.marketplace_orders DISABLE TRIGGER ${GAT_NOVO}`,
      `${trig("tgenabled::text")} = 'D'`,
      [LB.gatFn, LB.trig],
    ],
  ];
  for (const [rotulo, quem, sqlMut, guarda, linhasB] of PECAS_SOLTAS) {
    db[rotulo] = await novoPre(rotulo, sqlMut, guarda);
    await negativo(B, `B peça solta: ${quem}`, db[rotulo], linhasB);
  }
  // a 15b na árvore inteira e depois do apply reprova EXATAMENTE as peças que já existem
  const esperadasB = [...LB_PECAS, LB.vHash];
  await negativo(
    B,
    "B 15b depois do apply (árvore inteira)",
    cheio,
    esperadasB,
  );
  await negativo(
    B,
    "B 15b depois do apply (arquivo aplicado)",
    aplicado,
    esperadasB,
  );
  await negativo(
    B,
    "B 15b depois do apply (arquivo aplicado em CRLF)",
    crlf,
    esperadasB,
  );
  await negativo(B, "B 15b depois de ida, volta e ida", reaplicado, esperadasB);
  ok(
    "15b reprova EXATAMENTE a linha que divergiu: gatilho da 203 ausente, desabilitado ou AFTER; índice ausente ou sem o parcial; corpo da validação com 1 byte a mais, qualquer outro, o NOVO sem as peças (meia migration), sobrecarga extra e função ausente; cada uma das 5 colunas e das 3 funções do admin atual ausentes (a linha nomeia a que falta); cada peça NOVA solta (coluna, coluna e CHECK, tabela, cada função, sobrecarga alheia, gatilho — mesmo desabilitado); depois do apply reprova as 9 linhas das peças que já existem",
  );

  // ----------------------------------------------------------- MUTANTES
  const mutantesSoltos = [];
  const SEM_CLAUSULA = async (consulta, rotulo, trocas, base, esperadas) => {
    try {
      await mutanteTemQueSerPego(rotulo, consulta, trocas, base, esperadas);
    } catch (e) {
      mutantesSoltos.push(`${rotulo}: ${String(e.message).slice(0, 160)}`);
    }
  };
  // 15a
  await SEM_CLAUSULA(
    A,
    "A: hash da validação ignorado",
    [[L.valHash, "ELSE f.h END", `ELSE '${H.val.lf}' END`]],
    db.valCorpo,
    [L.valHash],
  );
  await SEM_CLAUSULA(
    A,
    "A: validação aceita o corpo da 203",
    [[L.valHash, "WHEN f.h IN (", `WHEN f.h IN ('${H203.lf}', `]],
    db.valMeia,
    [L.valHash],
  );
  await SEM_CLAUSULA(
    A,
    "A: hash da função do gatilho ignorado",
    [[L.gatHash, "ELSE f.h END", `ELSE '${H.gat.lf}' END`]],
    db.gatCorpo,
    [L.gatHash],
  );
  await SEM_CLAUSULA(
    A,
    "A: hash da lista ignorado",
    [[L.listaHash, "ELSE f.h END", `ELSE '${H.lista.lf}' END`]],
    db.listaCorpo,
    [L.listaHash],
  );
  await SEM_CLAUSULA(
    A,
    "A: hash do painel (ler) ignorado",
    [[L.lerHash, "ELSE f.h END", `ELSE '${H.ler.lf}' END`]],
    db.lerCorpo,
    [L.lerHash],
  );
  await SEM_CLAUSULA(
    A,
    "A: hash do painel (definir) ignorado",
    [[L.definirHash, "ELSE f.h END", `ELSE '${H.definir.lf}' END`]],
    db.definirCorpo,
    [L.definirHash],
  );
  await SEM_CLAUSULA(
    A,
    "A: default da coluna ignorado",
    [
      [
        L.alcCol,
        "COALESCE((SELECT a.forma FROM alc a), 'AUSENTE')",
        "COALESCE((SELECT 'text NOT NULL DEFAULT ''codigo''::text' FROM alc a), 'AUSENTE')",
      ],
    ],
    db.a2,
    [L.alcCol],
  );
  await SEM_CLAUSULA(
    A,
    "A: valores do CHECK ignorados",
    [
      [
        L.alcCk,
        "WHEN k.norma = 'checkalcance=anyarray[''codigo'',''vitrine'',''exclusivo'']'",
        "WHEN true",
      ],
    ],
    db.a7,
    [L.alcCk],
  );
  // (a cláusula `convalidated` do CHECK é cinto e suspensório: o próprio
  // pg_get_constraintdef já imprime NOT VALID, então tirá-la não afrouxa nada
  // e não existe mutante que a prova pudesse pegar.)
  await SEM_CLAUSULA(
    A,
    "A: colunas de cupom_clientes ignoradas",
    [
      [
        L.ccCols,
        "COALESCE((SELECT c.forma FROM ccol c), 'AUSENTE')",
        "'coupon_id:uuid:true,user_id:uuid:true,criado_em:timestamp with time zone:true'",
      ],
    ],
    db.t2,
    [L.ccCols],
  );
  await SEM_CLAUSULA(
    A,
    "A: RLS ignorada",
    [
      [
        L.ccRls,
        "CASE WHEN c.relrowsecurity THEN 'sim' ELSE 'nao' END",
        "'sim'",
      ],
    ],
    db.t5,
    [L.ccRls],
  );
  await SEM_CLAUSULA(
    A,
    "A: lista de políticas ignorada",
    [
      [
        L.ccPols,
        "COALESCE((SELECT p.lista FROM pol p), 'nenhuma')",
        "'cupom_clientes_admin_select_policy SELECT {authenticated} PERMISSIVE'",
      ],
    ],
    db.t6,
    [L.ccPols],
  );
  await SEM_CLAUSULA(
    A,
    "A: regra da política ignorada",
    [
      [
        L.ccRegra,
        "WHEN r.norma = 'selectrls_admin_atual' THEN",
        "WHEN true THEN",
      ],
    ],
    db.t8,
    [L.ccRegra],
  );
  await SEM_CLAUSULA(
    A,
    "A: privilégio por COLUNA de authenticated ignorado",
    [["has_any_column_privilege('authenticated', tab.cc, x.p)", "false"]],
    db.t13,
    [L.ccAuth],
  );
  await SEM_CLAUSULA(
    A,
    "A: privilégios de anon ignorados",
    [
      [
        L.ccAnon,
        "COALESCE((SELECT COALESCE(p.anon, 'papel anon ausente') FROM priv p), 'AUSENTE')",
        "'nenhum'",
      ],
    ],
    db.t14,
    [L.ccAnon],
  );
  await SEM_CLAUSULA(
    A,
    "A: privilégios de PUBLIC ignorados",
    [
      [
        "WHERE a.grantee = 0), 'nenhum') AS pub",
        "WHERE false), 'nenhum') AS pub",
      ],
    ],
    db.t16,
    [L.ccAnon, L.ccPub],
  );
  await SEM_CLAUSULA(
    A,
    "A: forma da lista ignorada",
    [
      [
        L.listaForma,
        "COALESCE((SELECT f.forma FROM fn f WHERE f.nome = 'cupons_do_checkout'), 'AUSENTE')",
        "'sql STABLE SECURITY DEFINER search_path=public -> record'",
      ],
    ],
    db.listaVol,
    [L.listaForma],
  );
  await SEM_CLAUSULA(
    A,
    "A: sobrecargas da validação ignoradas",
    [
      [
        L.valSobre,
        "(SELECT f.sobrecargas::text FROM fn f WHERE f.nome = 'validate_coupon_secure_v2')",
        "'1'",
      ],
    ],
    db.valSob,
    [L.valSobre],
  );
  await SEM_CLAUSULA(
    A,
    "A: EXECUTE de anon na lista ignorado",
    [
      [
        L.listaExec,
        "' anon=' || COALESCE(CASE WHEN f.exec_anon THEN 'sim' ELSE 'nao' END, 'papel ausente')",
        "' anon=sim'",
      ],
    ],
    // a lista sem EXECUTE para anon é o primeiro caso da tabela de ACL: refeito aqui
    await novo(
      "mut-acl-anon",
      `REVOKE EXECUTE ON FUNCTION ${sigDe(FN.lista)} FROM anon`,
      `NOT ${exec(FN.lista, "anon")}`,
    ),
    [L.listaExec],
  );
  await SEM_CLAUSULA(
    A,
    "A: EXECUTE de PUBLIC na lista ignorado",
    [
      [
        L.listaExec,
        "'PUBLIC=' || CASE WHEN f.exec_public THEN 'sim' ELSE 'nao' END",
        "'PUBLIC=nao'",
      ],
    ],
    db.listaPub,
    [L.listaExec],
  );
  await SEM_CLAUSULA(
    A,
    "A: habilitado do gatilho ignorado",
    [
      [
        L.gHab,
        "COALESCE((SELECT g.tgenabled FROM gat g), 'AUSENTE')",
        "COALESCE((SELECT 'O' FROM gat g), 'AUSENTE')",
      ],
    ],
    db.g2d,
    [L.gHab],
  );
  await SEM_CLAUSULA(
    A,
    "A: WHEN do gatilho ignorado",
    [
      [
        L.gWhen,
        "WHEN g.quando IS NULL THEN 'sem WHEN'",
        "WHEN false THEN 'sem WHEN'",
      ],
      [L.gWhen, "ELSE g.quando END", "ELSE 'new.coupon_id IS NOT NULL' END"],
    ],
    db.g3a,
    [L.gWhen],
  );
  await SEM_CLAUSULA(
    A,
    "A: evento do gatilho ignorado (BEFORE sempre)",
    [
      [
        L.gEvento,
        "WHEN g.tgtype & 2 = 2 THEN 'BEFORE'",
        "WHEN true THEN 'BEFORE'",
      ],
    ],
    db.g4b,
    [L.gEvento, L.gOrdem],
  );
  await SEM_CLAUSULA(
    A,
    "A: ordem de disparo sem filtrar BEFORE",
    [[L.gOrdem, "AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4", "AND true"]],
    db.g4b,
    [L.gEvento, L.gOrdem],
  );
  await SEM_CLAUSULA(
    A,
    "A: predicado do índice ignorado",
    [
      [
        L.iDef,
        "WHEN x.predicado IS NULL THEN 'sem predicado'",
        "WHEN false THEN 'sem predicado'",
      ],
      [
        L.iDef,
        "ELSE x.predicado END",
        "ELSE 'idempotency_key IS NOT NULL' END",
      ],
    ],
    db.i3,
    [L.iDef],
  );
  // 15b
  await SEM_CLAUSULA(
    B,
    "B: gatilho da 203 não precisa estar ativo",
    [
      [
        LB.gate203,
        "ELSE 'EXISTE mas nao ativo (habilitado=' || g.habilitado || ', tgtype=' || g.tgtype || ')' END",
        "ELSE 'ATIVO' END",
      ],
    ],
    db.b2,
    [LB.gate203],
  );
  await SEM_CLAUSULA(
    B,
    "B: corpo da validação ignorado",
    [[LB.vHash, "ELSE v.h END", `ELSE '${H203.lf}' END`]],
    db.b6,
    [LB.vHash],
  );
  await SEM_CLAUSULA(
    B,
    "B: aceita também o corpo NOVO da validação",
    [[LB.vHash, "CASE WHEN v.h IN (", `CASE WHEN v.h IN ('${H.val.lf}', `]],
    db.b7,
    [LB.vHash],
  );
  await SEM_CLAUSULA(
    B,
    "B: coluna alcance pode existir",
    [
      [
        LB.alcance,
        "THEN 'PRESENTE' ELSE 'AUSENTE' END",
        "THEN 'AUSENTE' ELSE 'AUSENTE' END",
      ],
    ],
    db.p1,
    [LB.alcance],
  );
  await SEM_CLAUSULA(
    B,
    "B: tabela cupom_clientes pode existir",
    [
      [
        LB.tabela,
        "THEN 'PRESENTE' ELSE 'AUSENTE' END",
        "THEN 'AUSENTE' ELSE 'AUSENTE' END",
      ],
    ],
    db.p3,
    [LB.tabela],
  );
  await SEM_CLAUSULA(
    B,
    "B: função da lista pode existir (qualquer assinatura)",
    [
      [
        LB.lista,
        "THEN 'PRESENTE' ELSE 'AUSENTE' END",
        "THEN 'AUSENTE' ELSE 'AUSENTE' END",
      ],
    ],
    db.p5,
    [LB.lista],
  );
  await SEM_CLAUSULA(
    B,
    "B: gatilho novo pode existir",
    [
      [
        LB.trig,
        "THEN 'EXISTE' ELSE 'AUSENTE' END",
        "THEN 'AUSENTE' ELSE 'AUSENTE' END",
      ],
    ],
    db.p10,
    [LB.gatFn, LB.trig],
  );
  await SEM_CLAUSULA(
    B,
    "B: colunas faltando ignoradas",
    [
      [
        LB.colunas,
        "COALESCE((SELECT 'AUSENTES: ' || string_agg(f.item, ', ' ORDER BY f.item) FROM faltam f), 'EXISTEM')",
        "'EXISTEM'",
      ],
    ],
    db.b11,
    [LB.colunas],
  );
  await SEM_CLAUSULA(
    B,
    "B: funções do admin atual ignoradas",
    [
      [
        LB.admins,
        "COALESCE((SELECT 'AUSENTES: ' || string_agg(a.nome, ', ' ORDER BY a.nome) FROM admin_faltam a), 'EXISTEM')",
        "'EXISTEM'",
      ],
    ],
    db.b17,
    [LB.admins],
  );
  await SEM_CLAUSULA(
    B,
    "B: predicado do índice ignorado",
    [
      [
        LB.iDef,
        "WHEN x.predicado IS NULL THEN 'sem predicado'",
        "WHEN false THEN 'sem predicado'",
      ],
      [
        LB.iDef,
        "ELSE x.predicado END",
        "ELSE 'idempotency_key IS NOT NULL' END",
      ],
    ],
    db.b5,
    [LB.iDef],
  );
  assert.deepEqual(mutantesSoltos, [], "mutantes que a prova NÃO pegou");
  ok(
    "34 MUTANTES do texto das consultas (hash de cada corpo, validação com o corpo da 203, default da coluna e valores do CHECK (a cláusula de CHECK validado é redundante com o NOT VALID de pg_get_constraintdef e não tem mutante), colunas, RLS, políticas e regra, privilégio por coluna / anon / PUBLIC, forma, sobrecarga e EXECUTE das funções, habilitado / WHEN / evento / filtro BEFORE da ordem do gatilho, predicado do índice; na 15b o gatilho da 203, o baseline, o aceite do corpo novo, cada ausência, as colunas, o admin atual e o índice) deixam o negativo correspondente PASSAR menos reprovado — a prova ficaria VERMELHA",
  );
  for (const [consulta, base, outra, baseOutra] of [
    [A, pre, B, pre],
    [B, cheio, A, cheio],
  ]) {
    const rows = await rodar(base, consulta);
    const parcial = rows.filter((r) => r.ok === true);
    assert.ok(parcial.length > 0 && parcial.length < rows.length);
    assert.ok(
      parcial.every((r) => r.ok === true),
      "todas as presentes são ok=true",
    );
    const v = veredito(consulta, parcial);
    assert.ok(v.endsWith("rol=invalido"), v);
    assert.equal(
      (await portaoComLog(consulta, v)).estado,
      "SEM_EVIDENCIA",
      "resposta PARCIAL com tudo ok=true nunca é positiva",
    );
    const dup = [...rows, rows[0]];
    assert.ok(veredito(consulta, dup).endsWith("rol=invalido"));
    assert.equal(
      (await portaoComLog(consulta, veredito(consulta, dup))).estado,
      "SEM_EVIDENCIA",
    );
    // o rol de uma consulta não vale para a outra
    assert.ok(
      veredito(consulta, await rodar(baseOutra, outra)).endsWith(
        "rol=invalido",
      ),
    );
  }
  ok(
    "rol FECHADO: a resposta PARCIAL (só as linhas ok=true), com linha duplicada ou com o rol da OUTRA consulta tem rol=invalido e o portão a trata como SEM_EVIDENCIA, nunca POSITIVA (15a e 15b)",
  );
  for (const consulta of [A, B]) {
    const quebrado = SQL[consulta].replace(
      "SELECT item, esperado, vivo, COALESCE",
      "SELEC item, esperado, vivo, COALESCE",
    );
    assert.notEqual(quebrado, SQL[consulta]);
    const r = await tentar(cheio, consulta, { sql: quebrado });
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
    "erro de SQL (42601): falha ALTA, nenhuma linha, e o portão fica SEM_EVIDENCIA mesmo com o run verde — erro nunca vira positivo (15a e 15b)",
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
    assert.ok(lote, "o canais-de-backend.json real não declara o lote da 15a");
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
        linhas: 37,
        okFalse: 0,
        naoBooleano: 0,
        rol: "ok",
      });
      const e1b = await executar(pre, B);
      assert.deepEqual(PORTAO.lerVeredicto(e1b.saida, B), {
        ref: REF_SAVY,
        sha: SHA40,
        linhas: 15,
        okFalse: 0,
        naoBooleano: 0,
        rol: "ok",
      });
      // E2: banco inexistente → HTTP 400, saída 1, NENHUM veredito, SEM_EVIDENCIA
      const e2 = await executar("pv_banco_que_nao_existe", A);
      assert.equal(e2.codigo, 1, e2.saida);
      assert.ok(!e2.saida.includes("VEREDITO-CONSULTA"), e2.saida);
      assert.equal((await evidencia(A, e2.saida)).estado, "SEM_EVIDENCIA");

      // L1: loja ANTES do apply (ledger sem a versão): 15a NEGATIVA + 15b POSITIVA → APLICAR
      const l1 = await decidir(pre, { faltam: [VERSAO], exigeProva: true });
      assert.equal(l1.prova.estado, "NEGATIVA");
      assert.equal(l1.diag.estado, "POSITIVA");
      assert.equal(l1.decisao.acao, "APLICAR", JSON.stringify(l1.decisao));
      assert.deepEqual(l1.decisao.versoes, [VERSAO]);
      // L2: loja DEPOIS do apply, ledger com a versão: 15a POSITIVA → NADA
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
      // L4: ledger com a versão mas o gatilho DESABILITADO (15a negativa) → PARAR
      const l4 = await decidir(db.g2d, { faltam: [], exigeProva: true });
      assert.equal(l4.prova.estado, "NEGATIVA");
      assert.equal(l4.decisao.acao, "PARAR", JSON.stringify(l4.decisao));
      // L5: ledger sem a versão, 15a NEGATIVA, mas a 15b NEGATIVA (a #777 não está no banco) → PARAR
      const l5 = await decidir(db.b1, { faltam: [VERSAO], exigeProva: true });
      assert.equal(l5.prova.estado, "NEGATIVA");
      assert.equal(l5.diag.estado, "NEGATIVA");
      assert.equal(l5.decisao.acao, "PARAR", JSON.stringify(l5.decisao));
      // L6: meia migration (a coluna e o CHECK sem o resto): 15a e 15b NEGATIVAS → PARAR
      const l6 = await decidir(db.p2, { faltam: [VERSAO], exigeProva: true });
      assert.equal(l6.prova.estado, "NEGATIVA");
      assert.equal(l6.diag.estado, "NEGATIVA");
      assert.equal(l6.decisao.acao, "PARAR", JSON.stringify(l6.decisao));
      // L7: DEPOIS do rollback manual a loja volta ao "antes": APLICAR de novo
      const l7 = await decidir(volta, { faltam: [VERSAO], exigeProva: true });
      assert.equal(l7.prova.estado, "NEGATIVA");
      assert.equal(l7.diag.estado, "POSITIVA");
      assert.equal(l7.decisao.acao, "APLICAR", JSON.stringify(l7.decisao));
      // L8: ida, volta e ida: a 15a volta a ser POSITIVA
      const l8 = await decidir(reaplicado, { faltam: [], exigeProva: true });
      assert.equal(l8.prova.estado, "POSITIVA");
      assert.equal(l8.decisao.acao, "NADA", JSON.stringify(l8.decisao));
      ok(
        "ponta a ponta (conferir-banco.cjs de verdade, HTTP local, papel de leitura, canais-de-backend.json REAL): ANTES do apply 15a NEGATIVA + 15b POSITIVA → APLICAR [20261208000000]; depois do apply 15a POSITIVA → NADA; objetos sem a versão no ledger → PARAR (sem backfill, sem apply); gatilho desabilitado → PARAR; gatilho da 203 ausente ou meia migration (15b negativa) → PARAR; DEPOIS do rollback manual → APLICAR de novo; depois de ida, volta e ida → NADA; banco inexistente → saída 1, sem veredito, SEM_EVIDENCIA",
      );
    } finally {
      await api.parar();
    }
  }

  console.log(`\n[cupons-do-checkout-portao-viva] ${resultados} provas ok`);
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
