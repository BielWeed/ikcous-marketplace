"use strict";

/**
 * Prova VIVA da consulta 8k (scripts/publicacao/consultas/
 * 8k-subtotal-divergente-ou-vazia-provada.sql) num Postgres EFÊMERO local — nada
 * de rede, nada de loja. A 8k é a 8c (subtotal x soma dos itens) com o furo
 * fechado: numa loja SEM pedido a 8c reprovava por construção (os dois controles
 * de visibilidade leem 0) e não deixava distinguir "loja vazia" de "papel cego
 * pela RLS". A 8k exige, em TODOS os ramos e nas DUAS tabelas, tabela comum
 * (relkind r), SELECT de tabela inteira, row_security_active=false (igual à
 * derivação do catálogo) e os tipos medidos; e só aceita o 0 como VAZIA PROVADA
 * quando essa pré-condição vale para as DUAS (a prova é conjunta). Com dados,
 * reproduz a 8c (controles >0, divergentes = 0, sem item = 0).
 *
 * COMO RODA: cada cenário num banco CLONADO (`CREATE DATABASE … TEMPLATE`, do banco
 * já migrado que o rodar-isolado.cjs entrega) que some no fim; a 8k sempre como um
 * papel de LEITURA não superusuário (o mesmo desenho do item (j) de
 * impressao-digital-viva.cjs), salvo o caso do superusuário. Cada veredito é
 * levado até o PORTÃO de verdade (`evidenciaDaProva`, de
 * scripts/frota/publicar-release.mjs): "positiva" aqui quer dizer POSITIVA para
 * o portão, com `rol=ok`; "reprova" quer dizer NEGATIVA ou SEM_EVIDENCIA, nunca
 * POSITIVA.
 *
 * CASOS (cada um com a LINHA exata que reprova; o veredito real, com rol=ok e o
 * ok_false esperado, é conferido em TODO caso):
 *  POSITIVOS  P1 banco vazio, com um CLONE do papel de produção (LOGIN BYPASSRLS +
 *             pg_read_all_data, sem GRANT direto); P1b sem BYPASSRLS, com a RLS
 *             desligada nas tabelas; P1c o papel é o DONO das tabelas (sem FORCE);
 *             P1d superusuário; P2 pedidos e itens coerentes (a 8k reproduz a 8c).
 *  NEGATIVOS  N1 RLS ativa com linhas OCULTAS pela política (e só pedidos ocultos);
 *             N2 RLS ativa e tabela vazia (inclusive só numa das duas; o dono com
 *             FORCE); N3 SELECT só de coluna (e coluna não coberta: 42501);
 *             N4 divergência (também com bypass e superusuário); N5 pedido sem
 *             item; N11 (N5b) pedidos de subtotal 0 sem nenhum item;
 *             N6 itens órfãos com 0 pedidos; N7 tipo errado (transação com
 *             ROLLBACK); N8 tabela ausente (42P01, o conferir-banco.cjs de verdade
 *             sai com erro, sem veredito); N9 VIEW de mesmo nome; N10 bypass e
 *             superusuário com dados divergentes; N12 vazia CONJUNTA (uma tabela
 *             visível e vazia, a outra com linhas escondidas, e o inverso); N13
 *             filho por herança sob pai vazio e tabela particionada; N14 dono com
 *             FORCE + USING (false) + linhas; N15 row_security=off (42501); N16
 *             tabelas de mesmo nome antes no search_path.
 *  FECHADO    L1 COM DADOS e RLS ativa (papel sem bypass vê só parte): a 8k reprova
 *             (a 8c legada aceitava).
 *  TIPOS      os tipos medidos com as migrations só até a 20261191 (o estado da
 *             Savy antes do lote 92-202) são os da árvore inteira.
 *
 * Toda mutação (de dados, de papel, de tabela) leva uma GUARDA que dá RAISE se
 * não aplicou: sem ela, um mutante que não aplica nada vira falso verde. Papéis
 * temporários com nome único, limpos no `finally`.
 *
 * LIMITE DECLARADO: o Postgres é o 17 LOCAL; o papel de leitura real da loja
 * (supabase_read_only_user) e a loja Savy não foram medidos aqui. Esta prova diz
 * que a consulta DECIDE certo, não que a Savy está vazia.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/subtotal-vazia-provada-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos vêm do próprio repositório (a pasta de consultas e o
 * publicar-release.mjs), nunca de entrada de rede. */

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
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do próprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);

const NOME_8K = "8k-subtotal-divergente-ou-vazia-provada";
const NOME_8C = "8c-subtotal-divergente";
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const SHA40 = "d".repeat(40);
const SQL_8K = fs.readFileSync(path.join(CONSULTAS, `${NOME_8K}.sql`), "utf8");
const SQL_8C = fs.readFileSync(path.join(CONSULTAS, `${NOME_8C}.sql`), "utf8");

// Os nomes das linhas da 8k (o rol fechado do código tem os mesmos 20).
const I = {
  papel: "papel efetivo",
  metaO: "marketplace_orders: metadados do papel efetivo",
  metaI: "marketplace_order_items: metadados do papel efetivo",
  relO: "marketplace_orders: relkind",
  relI: "marketplace_order_items: relkind",
  selO: "marketplace_orders: select de tabela inteira",
  selI: "marketplace_order_items: select de tabela inteira",
  rlsO: "marketplace_orders: row_security_active",
  rlsI: "marketplace_order_items: row_security_active",
  tOId: "marketplace_orders.id: tipo",
  tOSub: "marketplace_orders.subtotal: tipo",
  tIId: "marketplace_order_items.id: tipo",
  tIOrd: "marketplace_order_items.order_id: tipo",
  tIQtd: "marketplace_order_items.quantity: tipo",
  tIPreco: "marketplace_order_items.price: tipo",
  cPed: "controle: pedidos visiveis",
  cIte: "controle: itens de pedido visiveis",
  vazia: "vazia provada",
  div: "pedidos com soma dos itens diferente do subtotal",
  semItem: "  dos quais sem nenhum item",
};
const ordena = (l) => [...l].sort();

// Os tipos MEDIDOS na árvore inteira de migrations aplicada (PG 17 local): é o que
// o .sql declara como esperado.
const TIPOS_MEDIDOS = {
  [I.tOId]: "uuid",
  [I.tOSub]: "numeric(10,2)",
  [I.tIId]: "uuid",
  [I.tIOrd]: "uuid",
  [I.tIQtd]: "integer",
  [I.tIPreco]: "numeric(10,2)",
};

// Papéis NOVOS do cluster, com nome único por execução.
const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const P = {
  ro: `k8_ro_${SUF}`, // BYPASSRLS + pg_read_all_data: imita o supabase_read_only_user
  cego: `k8_cego_${SUF}`, // pg_read_all_data SEM BYPASSRLS: a RLS se aplica
  dono: `k8_dono_${SUF}`, // vira DONO das duas tabelas num clone
  coluna: `k8_col_${SUF}`, // só SELECT de coluna
  semsel: `k8_semsel_${SUF}`, // nenhum SELECT
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
async function clonar(rotulo) {
  const nome = `k8_${SUF}_${clones.length}_${rotulo}`.slice(0, 60);
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      await usar("template1", (a) =>
        a.query(`CREATE DATABASE "${nome}" TEMPLATE "${MOLDE}"`),
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

/** Monta um banco NOVO (provisiona e aplica as migrations que passam no filtro,
 * pelos mesmos scripts do rpc-ci.yml). As migrations vão para um diretório NOVO e
 * EXCLUSIVO desta execução (mkdtemp), removido no fim: nada compartilhado. */
async function montarBase(nome, filtro) {
  await usar("template1", (a) => a.query(`CREATE DATABASE "${nome}"`));
  clones.push(nome);
  const migrations = path.join(REPO, "supabase", "migrations");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "k8-"));
  try {
    for (const e of fs.readdirSync(migrations, { withFileTypes: true })) {
      if (
        e.isFile() &&
        e.name.endsWith(".sql") &&
        !e.name.startsWith("rollback-") &&
        filtro(e.name)
      )
        fs.copyFileSync(path.join(migrations, e.name), path.join(dir, e.name));
    }
    const env = { ...process.env, DATABASE_URL: urlDe(nome) };
    for (const argv of [
      [path.join(__dirname, "provisionar.cjs")],
      [path.join(__dirname, "aplicar-migrations.cjs"), dir],
    ]) {
      const r = spawnSync(process.execPath, argv, { env, encoding: "utf8" });
      assert.equal(
        r.status,
        0,
        `${path.basename(argv[0])} falhou ao montar ${nome}:
${(r.stdout || "").slice(-600)}
${(r.stderr || "").slice(-600)}`,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Uma mutação (de dado, papel ou tabela) SEGUIDA de uma guarda que dá RAISE se ela
 * não aplicou. `guarda` é uma expressão booleana que tem de ser VERDADEIRA depois. */
async function mutar(db, rotulo, sql, guarda) {
  await usar(db, async (c) => {
    await c.query(sql);
    await c.query(
      `DO $g$ BEGIN IF NOT COALESCE((${guarda}), false) THEN RAISE EXCEPTION 'a mutacao nao aplicou: ${rotulo.replace(/'/g, "''")}'; END IF; END $g$`,
    );
  });
}

const RLS_DE = (t) =>
  `(SELECT relrowsecurity FROM pg_class WHERE oid = 'public.${t}'::regclass)`;
const FORCE_DE = (t) =>
  `(SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.${t}'::regclass)`;
const DONO_DE = (t) =>
  `(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.${t}'::regclass)`;
const TABELAS = ["marketplace_orders", "marketplace_order_items"];
const contar = (db, t) =>
  usar(
    db,
    async (c) =>
      (await c.query(`SELECT count(*)::int AS n FROM public.${t}`)).rows[0].n,
  );

/** Os papéis SEM pg_read_all_data precisam de USAGE no schema extensions (f_unaccent, em
 * índice destas tabelas): sem ele o statement falha ANTES de chegar ao privilégio que se
 * quer provar. É da fixture, não da 8k. */
const usoDeExtensions = (db, papel) =>
  mutar(
    db,
    `USAGE em extensions para ${papel}`,
    `GRANT USAGE ON SCHEMA extensions TO ${papel}`,
    `has_schema_privilege('${papel}', 'extensions', 'USAGE')`,
  );

const desligarRls = async (db, rotulo, tabelas = TABELAS) => {
  for (const t of tabelas)
    await mutar(
      db,
      `${rotulo}: RLS desligada em ${t}`,
      `ALTER TABLE public.${t} DISABLE ROW LEVEL SECURITY`,
      `${RLS_DE(t)} IS FALSE`,
    );
};

// ---------------------------------------------------------------------------
// Fixtures: valores DISTINTIVOS (para provar que nenhum sai na resposta)
// ---------------------------------------------------------------------------
const PED = {
  A: "8a000000-0000-4000-8000-00000000000a",
  B: "8b000000-0000-4000-8000-00000000000b",
  C: "8c000000-0000-4000-8000-00000000000c",
};
const SUBTOTAL = { A: "28.67", B: "93.93", C: "14.43" };
const ITENS = {
  A: [
    [2, "7.77"],
    [1, "13.13"],
  ], // 15.54 + 13.13 = 28.67
  B: [[3, "31.31"]], // 93.93
  C: [
    [1, "5.55"],
    [4, "2.22"],
  ], // 5.55 + 8.88 = 14.43
};
const SEGREDOS = [
  ...Object.values(PED),
  ...Object.values(SUBTOTAL),
  "7.77",
  "13.13",
  "31.31",
  "5.55",
  "2.22",
];

/** Semeia no clone, como superusuário e com as FKs/gatilhos fora (replica), e
 * confere por contagem que o que devia entrar entrou. */
async function semear(db, { pedidos = [], itensAvulsos = [] }) {
  await usar(db, async (c) => {
    await c.query("SET session_replication_role = replica");
    for (const p of pedidos) {
      await c.query(
        `INSERT INTO public.marketplace_orders (id, customer_name, customer_data, total, subtotal)
         VALUES ($1, 'Cliente 8k', '{}'::jsonb, $2, $2)`,
        [p.id, p.subtotal],
      );
      for (const [q, preco] of p.itens ?? []) {
        await c.query(
          "INSERT INTO public.marketplace_order_items (order_id, quantity, price) VALUES ($1, $2, $3)",
          [p.id, q, preco],
        );
      }
    }
    for (const [orderId, q, preco] of itensAvulsos) {
      await c.query(
        "INSERT INTO public.marketplace_order_items (order_id, quantity, price) VALUES ($1, $2, $3)",
        [orderId, q, preco],
      );
    }
  });
  const itensEsperados =
    pedidos.reduce((n, p) => n + (p.itens ?? []).length, 0) +
    itensAvulsos.length;
  assert.equal(
    await contar(db, "marketplace_orders"),
    pedidos.length,
    "guarda: o semear não gravou os pedidos",
  );
  assert.equal(
    await contar(db, "marketplace_order_items"),
    itensEsperados,
    "guarda: o semear não gravou os itens",
  );
}
const pedidosOk = () => [
  { id: PED.A, subtotal: SUBTOTAL.A, itens: ITENS.A },
  { id: PED.B, subtotal: SUBTOTAL.B, itens: ITENS.B },
  { id: PED.C, subtotal: SUBTOTAL.C, itens: ITENS.C },
];

// ---------------------------------------------------------------------------
// Rodar a consulta
// ---------------------------------------------------------------------------
/** Roda a consulta como `papel` (null = o usuário da conexão, superusuário), em
 * transação somente leitura por padrão. Devolve as linhas ou LANÇA o erro do banco. */
async function rodar(db, { papel = P.ro, sql = SQL_8K, antes = [] } = {}) {
  assert.equal(CONF.contarStatements(sql), 1, "exatamente 1 statement");
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
      const r = await c.query(sql);
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
/** Devolve { rows } ou { erro } (o erro do banco, com `.code`). */
async function tentar(db, opcoes) {
  try {
    return { rows: await rodar(db, opcoes) };
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
/** Os campos `chave=valor; …` da linha de metadados/papel. */
function campos(l) {
  return Object.fromEntries(
    l.vivo.split("; ").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)];
    }),
  );
}

let PORTAO; // módulo ESM do portão (carregado em main)
/** O estado que o PORTÃO daria para esta resposta (ou para a falta dela). */
async function estadoNoPortao(rows) {
  const linhaDeVeredito = CONF.veredictoDaConsulta({
    consulta: NOME_8K,
    ref: REF_SAVY,
    sha: SHA40,
    linhas: rows,
  });
  return (await portaoComLog(linhaDeVeredito, "success")).estado;
}
async function portaoComLog(linhaDeVeredito, conclusao) {
  return PORTAO.evidenciaDaProva({
    consulta: NOME_8K,
    projeto: "savy",
    ref: REF_SAVY,
    sha: SHA40,
    topo: SHA40,
    validadeHoras: 6,
    agora: Date.now(),
    deps: {
      listarRuns: async (wf) =>
        wf === "conferir-banco-da-loja.yml"
          ? [
              {
                databaseId: 1,
                displayTitle: `conferir ${NOME_8K} em savy`,
                headSha: SHA40,
                createdAt: new Date().toISOString(),
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

/** Formato que vale para TODA resposta: 20 linhas, o rol fechado EXATO do código,
 * `ok` sempre booleano, nenhum id/valor/dado de cliente. */
function exigirFormato(rotulo, rows) {
  assert.equal(rows.length, 20, `${rotulo}: 20 linhas`);
  assert.equal(
    CONF.estruturaDoRolFechado(rows, CONF.ROL_DA_8K),
    null,
    `${rotulo}: o rol fechado do código tem de ser EXATAMENTE o que a consulta devolveu`,
  );
  for (const r of rows) {
    assert.equal(
      typeof r.ok,
      "boolean",
      `${rotulo}: ok não booleano em ${r.item}`,
    );
    assert.deepEqual(
      [typeof r.item, typeof r.esperado, typeof r.vivo],
      ["string", "string", "string"],
      `${rotulo}: item/esperado/vivo têm de ser texto`,
    );
  }
  const texto = JSON.stringify(rows);
  for (const segredo of SEGREDOS)
    assert.ok(
      !texto.includes(segredo),
      `${rotulo}: a resposta vazou "${segredo}"`,
    );
  // ok=false vem primeiro
  const oks = rows.map((r) => r.ok);
  assert.deepEqual(
    oks,
    [...oks].sort((a, b) => Number(a) - Number(b)),
    `${rotulo}: ok=false primeiro`,
  );
  // o tipo medido é o que a consulta declara como esperado
  for (const [item, tipo] of Object.entries(TIPOS_MEDIDOS))
    assert.equal(linha(rows, item).esperado, tipo, `${rotulo}: ${item}`);
}

/** POSITIVO: nenhuma linha reprova, o veredito sai com rol=ok e o portão dá POSITIVA. */
async function exigirPositiva(rotulo, rows) {
  exigirFormato(rotulo, rows);
  assert.deepEqual(reprovadas(rows), [], `${rotulo}: nada podia reprovar`);
  CONF.conferirRolFechado({
    faixa: "92-202",
    nomeConsulta: NOME_8K,
    linhas: rows,
    rol: CONF.ROL_DA_8K,
  });
  const v = CONF.veredictoDaConsulta({
    consulta: NOME_8K,
    ref: REF_SAVY,
    sha: SHA40,
    linhas: rows,
  });
  assert.match(v, /linhas=20 ok_false=0 ok_nao_booleano=0 rol=ok$/, rotulo);
  assert.equal(await estadoNoPortao(rows), "POSITIVA", rotulo);
}
/** NEGATIVO: reprova EXATAMENTE as linhas esperadas, e o portão NUNCA dá POSITIVA. */
async function exigirReprovadas(rotulo, rows, esperadas) {
  exigirFormato(rotulo, rows);
  assert.deepEqual(
    reprovadas(rows),
    ordena(esperadas),
    `${rotulo}: reprovou ${JSON.stringify(reprovadas(rows))}, esperava ${JSON.stringify(ordena(esperadas))}`,
  );
  const v = CONF.veredictoDaConsulta({
    consulta: NOME_8K,
    ref: REF_SAVY,
    sha: SHA40,
    linhas: rows,
  });
  assert.ok(
    v.endsWith(
      `linhas=20 ok_false=${esperadas.length} ok_nao_booleano=0 rol=ok`,
    ),
    `${rotulo}: veredito ${v}`,
  );
  assert.equal(await estadoNoPortao(rows), "NEGATIVA", rotulo);
}
/** Erro do banco: falha ALTA, sem linha nenhuma, e o portão não aceita a falta de veredito. */
async function exigirFalhaAlta(rotulo, resultado, codigo, trecho) {
  assert.ok(resultado.erro, `${rotulo}: devia falhar e devolveu linhas`);
  assert.equal(resultado.rows, undefined);
  assert.equal(
    resultado.erro.code,
    codigo,
    `${rotulo}: ${resultado.erro.code} ${resultado.erro.message}`,
  );
  if (trecho)
    assert.match(resultado.erro.message, trecho, `${rotulo}: mensagem`);
  // sem VEREDITO: o portão, mesmo com o run "verde", fica sem evidência
  assert.equal((await portaoComLog(null, "success")).estado, "SEM_EVIDENCIA");
  assert.equal((await portaoComLog(null, "failure")).estado, "SEM_EVIDENCIA");
}

/** A 8k REPRODUZ a 8c: nas 4 linhas que as duas têm, o `ok` e (nas duas
 * contagens) o `vivo` são iguais, para o MESMO papel e o MESMO banco. */
async function igualA8c(rotulo, db, papel, rows8k) {
  const r8c = await rodar(db, { papel, sql: SQL_8C });
  for (const item of [I.cPed, I.cIte, I.div, I.semItem])
    assert.equal(
      linha(rows8k, item).ok,
      linha(r8c, item).ok,
      `${rotulo}: a 8k diverge da 8c em "${item}"`,
    );
  for (const item of [I.div, I.semItem])
    assert.equal(linha(rows8k, item).vivo, linha(r8c, item).vivo, rotulo);
  return r8c;
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
  assert.ok(
    PORTAO.CONSULTAS_DE_ROL_FECHADO.has(NOME_8K),
    "o portão tem de tratar a 8k como consulta de ROL FECHADO (só vale com rol=ok)",
  );
  assert.deepEqual(
    Object.keys(CONF.ROL_FECHADO_POR_CONSULTA).sort(),
    [...PORTAO.CONSULTAS_DE_ROL_FECHADO].sort(),
  );
  assert.equal(
    Object.entries(CONF.ROL_FECHADO_POR_CONSULTA).find(
      ([n]) => n === NOME_8K,
    )?.[1],
    CONF.ROL_DA_8K,
  );
  assert.deepEqual(
    ordena(CONF.ROL_DA_8K),
    ordena(Object.values(I)),
    "o rol do código é o conjunto de itens que esta prova conhece",
  );

  // Os papéis são do CLUSTER; a prova os cria (nomes únicos) e os remove no finally.
  await usar("template1", async (a) => {
    // CLONE do papel de produção (supabase/postgres, initial-schema.sql): LOGIN BYPASSRLS +
    // pg_read_all_data, SEM GRANT direto, e read-only por padrão.
    await a.query(`CREATE ROLE ${P.ro} LOGIN BYPASSRLS`);
    await a.query(`ALTER ROLE ${P.ro} SET default_transaction_read_only = on`);
    await a.query(`CREATE ROLE ${P.cego} NOLOGIN`);
    await a.query(`CREATE ROLE ${P.dono} NOLOGIN`);
    await a.query(`CREATE ROLE ${P.coluna} NOLOGIN`);
    await a.query(`CREATE ROLE ${P.semsel} NOLOGIN`);
    await a.query(`GRANT pg_read_all_data TO ${P.ro}, ${P.cego}`);
  });

  // ----------------------------------------------------------- precondição
  {
    const sonda = await usar(MOLDE, async (c) => {
      const o = {};
      o.marketplace_orders = (
        await c.query(
          "SELECT count(*)::int AS n FROM public.marketplace_orders",
        )
      ).rows[0].n;
      o.marketplace_order_items = (
        await c.query(
          "SELECT count(*)::int AS n FROM public.marketplace_order_items",
        )
      ).rows[0].n;
      o.rls = (
        await c.query(
          `SELECT bool_and(relrowsecurity) AS rls FROM pg_class WHERE oid IN ('public.marketplace_orders'::regclass, 'public.marketplace_order_items'::regclass)`,
        )
      ).rows[0].rls;
      o.papeis = (
        await c.query(
          "SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname",
          [Object.values(P)],
        )
      ).rows;
      o.eu = (
        await c.query(
          "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
        )
      ).rows[0].rolsuper;
      for (const [item, tipo] of Object.entries(TIPOS_MEDIDOS)) {
        const [t, col] = item.replace(": tipo", "").split(".");
        const lido = (
          await c.query(
            "SELECT format_type(atttypid, atttypmod) AS tipo FROM pg_attribute WHERE attrelid = $1::regclass AND attname = $2 AND NOT attisdropped",
            [`public.${t}`, col],
          )
        ).rows[0].tipo;
        assert.equal(lido, tipo, `tipo MEDIDO diverge do declarado: ${item}`);
      }
      return o;
    });
    assert.deepEqual(
      [sonda.marketplace_orders, sonda.marketplace_order_items],
      [0, 0],
      "precondição: o banco migrado começa sem pedido nem item",
    );
    assert.equal(
      sonda.rls,
      true,
      "precondição: a RLS está ligada nas duas tabelas",
    );
    assert.equal(
      sonda.eu,
      true,
      "precondição: a conexão da prova é superusuário",
    );
    assert.equal(
      JSON.stringify(sonda.papeis.map((p) => [p.rolbypassrls, p.rolsuper])),
      JSON.stringify(
        sonda.papeis.map((p) => [p.rolname.startsWith("k8_ro_"), false]),
      ),
      "precondição: só o papel de leitura tem BYPASSRLS; nenhum é superusuário",
    );
    ok(
      `precondição: banco migrado vazio, RLS ligada nas duas tabelas, tipos MEDIDOS = declarados (${Object.values(TIPOS_MEDIDOS).join(", ")})`,
    );
  }

  const vazio = await clonar("vazio");

  // ------------------------------------------------------------------ P1
  {
    // o papel é o CLONE do de produção: LOGIN BYPASSRLS + pg_read_all_data, sem GRANT direto
    const grantsDiretos = await usar(
      vazio,
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int AS n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
            WHERE c.oid IN ('public.marketplace_orders'::regclass, 'public.marketplace_order_items'::regclass)
              AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $1)`,
            [P.ro],
          )
        ).rows[0].n,
    );
    assert.equal(
      grantsDiretos,
      0,
      "o papel de leitura não pode ter GRANT direto nas tabelas",
    );
    const rows = await rodar(vazio);
    await exigirPositiva("P1", rows);
    assert.equal(linha(rows, I.vazia).vivo, "VAZIA PROVADA");
    assert.equal(linha(rows, I.cPed).vivo, "0 (vazia provada)");
    assert.equal(linha(rows, I.cIte).vivo, "0 (vazia provada)");
    const meta = campos(linha(rows, I.metaO));
    assert.equal(meta.row_security_active, "false");
    assert.equal(
      meta.rls_ligada,
      "true",
      "a RLS está LIGADA, mas não ATIVA para o papel (bypass)",
    );
    assert.equal(meta.select, "true");
    assert.equal(meta.linhas, "0");
    const papel = campos(linha(rows, I.papel));
    assert.equal(papel.current_user, P.ro);
    assert.equal(papel.rolbypassrls, "true");
    assert.equal(papel.rolsuper, "false");
    // o portão: a 8k vazia provada é POSITIVA; a 8c, na MESMA loja, reprova
    const r8c = await rodar(vazio, { sql: SQL_8C });
    assert.deepEqual(reprovadas(r8c), [I.cIte, I.cPed].sort());
    ok(
      "P1 banco vazio, papel de leitura (BYPASSRLS, SELECT de tabela): 8k POSITIVA (VAZIA PROVADA, rol=ok, 20 linhas); a 8c na mesma loja reprova os dois controles (o furo que a 8k fecha)",
    );
  }

  // ------------------------------------------------------------------ P1b
  {
    const db = await clonar("p1b");
    await desligarRls(db, "P1b");
    const rows = await rodar(db, { papel: P.cego });
    await exigirPositiva("P1b", rows);
    const papel = campos(linha(rows, I.papel));
    assert.equal(papel.rolbypassrls, "false", "sem BYPASSRLS");
    assert.equal(campos(linha(rows, I.metaO)).rls_ligada, "false");
    assert.equal(campos(linha(rows, I.metaO)).row_security_active, "false");
    ok(
      "P1b banco vazio, papel SEM BYPASSRLS mas com a RLS desligada nas duas tabelas: POSITIVA (a prova não depende de bypass, depende de row_security_active=false)",
    );
  }

  // ------------------------------------------------------------------ P1c
  {
    const db = await clonar("p1c");
    await usoDeExtensions(db, P.dono);
    for (const t of TABELAS)
      await mutar(
        db,
        `P1c: ${P.dono} dono de ${t}`,
        `ALTER TABLE public.${t} OWNER TO ${P.dono}`,
        `${DONO_DE(t)} = '${P.dono}' AND ${FORCE_DE(t)} IS FALSE AND ${RLS_DE(t)} IS TRUE`,
      );
    const rows = await rodar(db, { papel: P.dono });
    await exigirPositiva("P1c", rows);
    const meta = campos(linha(rows, I.metaO));
    assert.equal(meta.dono, "true");
    assert.equal(meta.rls_ligada, "true");
    assert.equal(meta.rls_forcada, "false");
    assert.equal(
      meta.row_security_active,
      "false",
      "o dono sem FORCE ignora a RLS",
    );
    ok(
      "P1c banco vazio, o papel é DONO das duas tabelas (RLS ligada, sem FORCE): POSITIVA (row_security_active=false)",
    );

    // N2b (aproveita o clone): FORCE sujeita o dono à RLS → o 0 não prova nada
    for (const t of TABELAS)
      await mutar(
        db,
        `N2b: FORCE em ${t}`,
        `ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY`,
        `${FORCE_DE(t)} IS TRUE`,
      );
    const rf = await rodar(db, { papel: P.dono });
    await exigirReprovadas("N2b", rf, [
      I.rlsO,
      I.rlsI,
      I.cPed,
      I.cIte,
      I.vazia,
    ]);
    assert.equal(campos(linha(rf, I.metaO)).row_security_active, "true");
    ok(
      "N2b banco vazio, o DONO com FORCE ROW LEVEL SECURITY: a RLS passa a valer para ele, o 0 NÃO é provado → reprova 'vazia provada' e os dois controles",
    );
  }

  // ------------------------------------------------------------------ P1d + N10b
  {
    const rows = await rodar(vazio, { papel: null });
    await exigirPositiva("P1d", rows);
    const papel = campos(linha(rows, I.papel));
    assert.equal(papel.rolsuper, "true");
    assert.equal(papel.rolbypassrls, "true");
    assert.equal(campos(linha(rows, I.metaO)).row_security_active, "false");
    ok(
      "P1d / N10 banco vazio, SUPERUSUÁRIO: POSITIVA (rolsuper e rolbypassrls = true → row_security_active=false é legítimo: o papel VÊ tudo)",
    );
  }

  // ------------------------------------------------------------------ P2
  const comDados = await clonar("dados");
  await semear(comDados, { pedidos: pedidosOk() });
  {
    const rows = await rodar(comDados);
    await exigirPositiva("P2", rows);
    assert.equal(linha(rows, I.cPed).vivo, ">0");
    assert.equal(linha(rows, I.cIte).vivo, ">0");
    assert.equal(
      linha(rows, I.vazia).vivo,
      "nao se aplica (ha linhas visiveis)",
    );
    assert.equal(linha(rows, I.div).vivo, "0");
    assert.equal(linha(rows, I.semItem).vivo, "0");
    assert.equal(campos(linha(rows, I.metaO)).linhas, ">0");
    assert.equal(campos(linha(rows, I.metaI)).linhas, ">0");
    const r8c = await igualA8c("P2", comDados, P.ro, rows);
    assert.deepEqual(reprovadas(r8c), []);
    // o dono (RLS ignorada) e o superusuário veem o mesmo
    await exigirPositiva(
      "P2 superusuário",
      await rodar(comDados, { papel: null }),
    );
    ok(
      "P2 3 pedidos / 4 itens coerentes (subtotal = soma): 8k POSITIVA (controles >0, 0 divergentes, 0 sem item) e IGUAL à 8c linha a linha; nenhum id nem valor na resposta",
    );
  }

  // ------------------------------------------------------------------ N1
  {
    const db = await clonar("n1");
    await semear(db, { pedidos: pedidosOk() });
    for (const t of TABELAS)
      await mutar(
        db,
        `N1: política que esconde ${t} de ${P.cego}`,
        `CREATE POLICY k8_oculta ON public.${t} FOR SELECT TO ${P.cego} USING (false)`,
        `EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.${t}'::regclass AND polname = 'k8_oculta')`,
      );
    // controle: o papel COM bypass vê os pedidos (as linhas existem), o cego não
    const vistaPorQuemEnxerga = await rodar(db, { papel: P.ro });
    await exigirPositiva("N1 controle (bypass)", vistaPorQuemEnxerga);
    const rows = await rodar(db, { papel: P.cego });
    await exigirReprovadas("N1a", rows, [
      I.rlsO,
      I.rlsI,
      I.cPed,
      I.cIte,
      I.vazia,
    ]);
    assert.equal(
      linha(rows, I.vazia).vivo.startsWith("ZERO NAO PROVADO"),
      true,
    );
    assert.equal(linha(rows, I.cPed).vivo, "0");
    assert.equal(campos(linha(rows, I.metaO)).row_security_active, "true");
    assert.equal(campos(linha(rows, I.metaI)).row_security_active, "true");
    assert.equal(campos(linha(rows, I.metaO)).linhas, "0");
    assert.equal(
      await contar(db, "marketplace_orders"),
      3,
      "as linhas EXISTEM (superusuário)",
    );
    await igualA8c("N1a", db, P.cego, rows);
    ok(
      "N1a 3 pedidos existem mas a RLS (política USING false) os esconde do papel sem BYPASSRLS: ele lê 0/0 → NÃO vira 'vazia provada': reprova 'vazia provada' + os dois controles (a 8c reprova igual)",
    );

    // N1b: só os PEDIDOS ficam ocultos (RLS desligada nos itens) → itens >0, pedidos 0
    const db2 = await clonar("n1b");
    await semear(db2, { pedidos: pedidosOk() });
    await mutar(
      db2,
      `N1b: política que esconde marketplace_orders de ${P.cego}`,
      `CREATE POLICY k8_oculta ON public.marketplace_orders FOR SELECT TO ${P.cego} USING (false)`,
      `EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.marketplace_orders'::regclass AND polname = 'k8_oculta')`,
    );
    await desligarRls(db2, "N1b", ["marketplace_order_items"]);
    const r2 = await rodar(db2, { papel: P.cego });
    await exigirReprovadas("N1b", r2, [I.rlsO, I.cPed]);
    assert.equal(linha(r2, I.cIte).vivo, ">0");
    assert.equal(
      linha(r2, I.div).vivo,
      "0",
      "0 pedidos visíveis: o 0 de divergentes é o 0 que engana",
    );
    assert.equal(linha(r2, I.vazia).vivo, "nao se aplica (ha linhas visiveis)");
    await igualA8c("N1b", db2, P.cego, r2);
    ok(
      "N1b só os pedidos ocultos (itens visíveis): 'controle: pedidos visiveis' reprova (os 0 divergentes são o zero que engana); é o controle >0 do ramo COM dados",
    );
  }

  // ------------------------------------------------------------------ N2
  {
    const rows = await rodar(vazio, { papel: P.cego });
    await exigirReprovadas("N2", rows, [
      I.rlsO,
      I.rlsI,
      I.cPed,
      I.cIte,
      I.vazia,
    ]);
    assert.equal(
      linha(rows, I.vazia).vivo.startsWith("ZERO NAO PROVADO"),
      true,
    );
    assert.equal(campos(linha(rows, I.metaO)).row_security_active, "true");
    await igualA8c("N2", vazio, P.cego, rows);
    ok(
      "N2 tabelas realmente vazias mas a RLS está ATIVA para o papel (sem BYPASSRLS): o 0 não é conclusivo → reprova 'vazia provada' + os dois controles",
    );

    // N2c: 'para AS DUAS' — RLS desligada nos pedidos, ATIVA nos itens
    const db = await clonar("n2c");
    await desligarRls(db, "N2c", ["marketplace_orders"]);
    assert.equal(
      await usar(
        db,
        async (c) =>
          (await c.query(`SELECT ${RLS_DE("marketplace_order_items")} AS r`))
            .rows[0].r,
      ),
      true,
    );
    const r2 = await rodar(db, { papel: P.cego });
    await exigirReprovadas("N2c", r2, [I.rlsI, I.cPed, I.cIte, I.vazia]);
    assert.equal(campos(linha(r2, I.metaO)).row_security_active, "false");
    assert.equal(campos(linha(r2, I.metaI)).row_security_active, "true");
    // e o inverso
    const db3 = await clonar("n2d");
    await desligarRls(db3, "N2d", ["marketplace_order_items"]);
    const r3 = await rodar(db3, { papel: P.cego });
    await exigirReprovadas("N2d", r3, [I.rlsO, I.cPed, I.cIte, I.vazia]);
    assert.equal(campos(linha(r3, I.metaO)).row_security_active, "true");
    assert.equal(campos(linha(r3, I.metaI)).row_security_active, "false");
    ok(
      "N2c/N2d vazia, RLS inativa em UMA tabela e ativa na outra (nas duas ordens): não é 'para as duas' → reprova",
    );
  }

  // ------------------------------------------------------------------ N3
  {
    const grantar = async (db, rotulo, ordCols, iteCols) => {
      await mutar(
        db,
        `${rotulo}: SELECT só de colunas em marketplace_orders`,
        `GRANT SELECT (${ordCols}) ON public.marketplace_orders TO ${P.coluna}`,
        `has_column_privilege('${P.coluna}', 'public.marketplace_orders', 'id', 'SELECT') AND NOT has_table_privilege('${P.coluna}', 'public.marketplace_orders', 'SELECT')`,
      );
      await mutar(
        db,
        `${rotulo}: SELECT só de colunas em marketplace_order_items`,
        `GRANT SELECT (${iteCols}) ON public.marketplace_order_items TO ${P.coluna}`,
        `has_column_privilege('${P.coluna}', 'public.marketplace_order_items', 'id', 'SELECT') AND NOT has_table_privilege('${P.coluna}', 'public.marketplace_order_items', 'SELECT')`,
      );
    };
    const COLS_O = "id, subtotal";
    const COLS_I = "id, order_id, quantity, price";
    for (const [rotulo, comDados_] of [
      ["vazio", false],
      ["com dados", true],
    ]) {
      const db = await clonar(`n3_${comDados_ ? "dados" : "vazio"}`);
      if (comDados_) await semear(db, { pedidos: pedidosOk() });
      await desligarRls(db, `N3 ${rotulo}`);
      await usoDeExtensions(db, P.coluna);
      await grantar(db, `N3 ${rotulo}`, COLS_O, COLS_I);
      const sonda = await usar(db, async (c) => {
        await c.query(`SET ROLE ${P.coluna}`);
        try {
          return (
            await c.query(
              `SELECT has_table_privilege(current_user, 'public.marketplace_orders', 'SELECT') AS tab_o,
                      has_table_privilege(current_user, 'public.marketplace_order_items', 'SELECT') AS tab_i,
                      has_column_privilege(current_user, 'public.marketplace_order_items', 'price', 'SELECT') AS col_price,
                      (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user) AS poder`,
            )
          ).rows[0];
        } finally {
          await c.query("RESET ROLE");
        }
      });
      assert.deepEqual(sonda, {
        tab_o: false,
        tab_i: false,
        col_price: true,
        poder: false,
      });
      const r = await tentar(db, { papel: P.coluna });
      assert.ok(
        r.rows,
        `N3 ${rotulo}: com SELECT em todas as colunas que a fórmula lê o statement RODA (${r.erro?.message})`,
      );
      const esperadas = comDados_
        ? [I.selO, I.selI]
        : [I.selO, I.selI, I.cPed, I.cIte, I.vazia];
      await exigirReprovadas(`N3 ${rotulo}`, r.rows, esperadas);
      assert.equal(linha(r.rows, I.selO).vivo, "false");
      assert.equal(linha(r.rows, I.selI).vivo, "false");
      assert.equal(campos(linha(r.rows, I.metaO)).select, "false");
      assert.equal(
        campos(linha(r.rows, I.metaO)).row_security_active,
        "false",
        "a RLS não é a causa: o que reprova é o privilégio",
      );
      if (comDados_) {
        // o statement LEU as linhas (por coluna) e a soma bate: o que reprova é só o privilégio
        assert.equal(linha(r.rows, I.div).vivo, "0");
        assert.equal(linha(r.rows, I.cPed).vivo, ">0");
      }
      ok(
        `N3 SELECT só de coluna nas colunas que a fórmula lê (${rotulo}): o statement RODA e reprova na linha de privilégio${comDados_ ? " (as duas 'select de tabela inteira')" : " (as duas 'select de tabela inteira' + 'vazia provada' + os dois controles)"}`,
      );
    }
    // N3b: coluna NÃO coberta (price) → o statement INTEIRO falha alto (42501)
    const db = await clonar("n3b");
    await desligarRls(db, "N3b");
    await usoDeExtensions(db, P.coluna);
    await usoDeExtensions(db, P.semsel);
    await grantar(db, "N3b", COLS_O, "id, order_id, quantity");
    assert.equal(
      await usar(
        db,
        async (c) =>
          (
            await c.query(
              `SELECT has_column_privilege('${P.coluna}', 'public.marketplace_order_items', 'price', 'SELECT') AS x`,
            )
          ).rows[0].x,
      ),
      false,
      "guarda: o papel não tem a coluna price",
    );
    const rb = await tentar(db, { papel: P.coluna });
    await exigirFalhaAlta(
      "N3b",
      rb,
      "42501",
      /permission denied for table marketplace_order_items/,
    );
    // N3c: nenhum SELECT → 42501 já na primeira tabela
    const rc = await tentar(db, { papel: P.semsel });
    await exigirFalhaAlta(
      "N3c",
      rc,
      "42501",
      /permission denied for table marketplace_order/,
    );
    ok(
      "N3b/N3c SELECT de coluna que NÃO cobre `price`, ou nenhum SELECT: o statement INTEIRO falha alto (42501 permission denied for table …), sem linha e sem veredito → o portão fica SEM_EVIDENCIA",
    );
  }

  // ------------------------------------------------------------------ N4
  {
    const db = await clonar("n4");
    await semear(db, { pedidos: pedidosOk() });
    await mutar(
      db,
      "N4: subtotal do pedido B adulterado",
      `UPDATE public.marketplace_orders SET subtotal = 999.99 WHERE id = '${PED.B}'`,
      `(SELECT subtotal FROM public.marketplace_orders WHERE id = '${PED.B}') = 999.99`,
    );
    const rows = await rodar(db);
    await exigirReprovadas("N4", rows, [I.div]);
    assert.equal(linha(rows, I.div).vivo, "1");
    assert.equal(linha(rows, I.semItem).vivo, "0");
    await igualA8c("N4", db, P.ro, rows);
    // N10b: o mesmo com superusuário (bypass) e com o dono: divergência é divergência
    await exigirReprovadas(
      "N4 superusuário",
      await rodar(db, { papel: null }),
      [I.div],
    );
    // item alterado em vez do subtotal: 2 divergentes
    await mutar(
      db,
      "N4: quantidade do item do pedido C alterada",
      `UPDATE public.marketplace_order_items SET quantity = 9 WHERE order_id = '${PED.C}' AND price = 5.55`,
      `(SELECT quantity FROM public.marketplace_order_items WHERE order_id = '${PED.C}' AND price = 5.55) = 9`,
    );
    const r2 = await rodar(db);
    await exigirReprovadas("N4b", r2, [I.div]);
    assert.equal(linha(r2, I.div).vivo, "2");
    ok(
      "N4 / N10b subtotal adulterado (1 divergente) e depois item alterado (2): reprova 'pedidos com soma dos itens diferente do subtotal' com o papel bypass e com o superusuário; igual à 8c",
    );
  }

  // ------------------------------------------------------------------ N5
  {
    const db = await clonar("n5");
    await semear(db, { pedidos: pedidosOk() });
    await mutar(
      db,
      "N5: itens do pedido C apagados",
      `DELETE FROM public.marketplace_order_items WHERE order_id = '${PED.C}'`,
      `NOT EXISTS (SELECT 1 FROM public.marketplace_order_items WHERE order_id = '${PED.C}')`,
    );
    const rows = await rodar(db);
    await exigirReprovadas("N5", rows, [I.div, I.semItem]);
    assert.equal(linha(rows, I.div).vivo, "1");
    assert.equal(linha(rows, I.semItem).vivo, "1");
    await igualA8c("N5", db, P.ro, rows);

    // N5b: pedidos de subtotal 0 SEM NENHUM item: a soma bate (0 = 0), só o controle de itens pega
    const db2 = await clonar("n5b");
    await semear(db2, {
      pedidos: [
        { id: PED.A, subtotal: "0.00", itens: [] },
        { id: PED.B, subtotal: "0.00", itens: [] },
      ],
    });
    const r2 = await rodar(db2);
    await exigirReprovadas("N5b", r2, [I.cIte]);
    assert.equal(linha(r2, I.cPed).vivo, ">0");
    assert.equal(linha(r2, I.cIte).vivo, "0");
    assert.equal(linha(r2, I.div).vivo, "0");
    assert.equal(linha(r2, I.vazia).vivo, "nao se aplica (ha linhas visiveis)");
    await igualA8c("N5b", db2, P.ro, r2);
    ok(
      "N5 pedido sem item (subtotal>0): reprova 'pedidos com soma…' e '  dos quais sem nenhum item'; N5b pedidos de subtotal 0 sem nenhum item (a soma bate): reprova 'controle: itens de pedido visiveis' — pedidos visíveis com 0 itens reprova",
    );
  }

  // ------------------------------------------------------------------ N6
  {
    const db = await clonar("n6");
    await semear(db, {
      itensAvulsos: [
        ["f0000000-0000-4000-8000-0000000000f1", 2, "7.77"],
        [null, 1, "13.13"],
      ],
    });
    const rows = await rodar(db);
    await exigirReprovadas("N6", rows, [I.cPed]);
    assert.equal(linha(rows, I.cPed).vivo, "0");
    assert.equal(linha(rows, I.cIte).vivo, ">0");
    assert.equal(
      linha(rows, I.vazia).vivo,
      "nao se aplica (ha linhas visiveis)",
    );
    await igualA8c("N6", db, P.ro, rows);
    ok(
      "N6 itens ÓRFÃOS visíveis (um com order_id inexistente, um nulo) e 0 pedidos: reprova 'controle: pedidos visiveis' (itens com 0 pedidos NÃO viram vazia provada)",
    );
  }

  // ------------------------------------------------------------------ N7
  {
    const mutacoesDeTipo = [
      {
        rotulo: "price double precision",
        sql: "ALTER TABLE public.marketplace_order_items ALTER COLUMN price TYPE double precision",
        guarda: `(SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.marketplace_order_items'::regclass AND attname = 'price') = 'double precision'`,
        linha: I.tIPreco,
        vivo: "double precision",
      },
      {
        rotulo: "subtotal numeric sem (10,2)",
        sql: "ALTER TABLE public.marketplace_orders ALTER COLUMN subtotal TYPE numeric",
        guarda: `(SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.marketplace_orders'::regclass AND attname = 'subtotal') = 'numeric'`,
        linha: I.tOSub,
        vivo: "numeric",
      },
      {
        rotulo: "quantity bigint",
        sql: "ALTER TABLE public.marketplace_order_items ALTER COLUMN quantity TYPE bigint",
        guarda: `(SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.marketplace_order_items'::regclass AND attname = 'quantity') = 'bigint'`,
        linha: I.tIQtd,
        vivo: "bigint",
      },
    ];
    for (const m of mutacoesDeTipo) {
      const resultado = await usar(vazio, async (c) => {
        await c.query("BEGIN");
        try {
          await c.query(m.sql);
          await c.query(
            `DO $g$ BEGIN IF NOT COALESCE((${m.guarda}), false) THEN RAISE EXCEPTION 'a mutacao nao aplicou: ${m.rotulo}'; END IF; END $g$`,
          );
          await c.query(`SET LOCAL ROLE ${P.ro}`);
          return (await c.query(SQL_8K)).rows;
        } finally {
          await c.query("ROLLBACK");
        }
      });
      await exigirReprovadas(`N7 ${m.rotulo}`, resultado, [m.linha]);
      assert.equal(linha(resultado, m.linha).vivo, m.vivo);
      // o ROLLBACK desfez: o molde voltou ao tipo medido
      const depois = await rodar(vazio);
      await exigirPositiva(`N7 depois do ROLLBACK (${m.rotulo})`, depois);
    }
    ok(
      "N7 tipo errado numa transação com ROLLBACK (price double precision, subtotal numeric sem (10,2), quantity bigint): cada um reprova SÓ a linha do tipo, com o tipo vivo escrito; o ROLLBACK desfaz e a 8k volta a ser positiva",
    );
  }

  // ------------------------------------------------------------------ N8
  {
    const r = await usar(vazio, async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(
          "ALTER TABLE public.marketplace_order_items RENAME TO k8_ausente_temporaria",
        );
        await c.query(
          `DO $g$ BEGIN IF to_regclass('public.marketplace_order_items') IS NOT NULL THEN RAISE EXCEPTION 'a mutacao nao aplicou: tabela ausente'; END IF; END $g$`,
        );
        await c.query(`SET LOCAL ROLE ${P.ro}`);
        try {
          return { rows: (await c.query(SQL_8K)).rows };
        } catch (erro) {
          return { erro };
        }
      } finally {
        await c.query("ROLLBACK");
      }
    });
    await exigirFalhaAlta(
      "N8",
      r,
      "42P01",
      /relation "public.marketplace_order_items" does not exist/,
    );
    assert.ok(
      to_regclass_ok(
        await usar(vazio, (c) =>
          c.query("SELECT to_regclass('public.marketplace_order_items') AS t"),
        ),
      ),
      "o ROLLBACK devolveu a tabela",
    );
    ok(
      "N8 tabela marketplace_order_items AUSENTE (renomeada numa transação): o statement INTEIRO falha alto (42P01), sem nenhuma linha e sem veredito → SEM_EVIDENCIA no portão; o ROLLBACK devolve a tabela",
    );
  }

  // ------------------------------------------------------------------ N9
  {
    const rows = await usar(vazio, async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(
          "ALTER TABLE public.marketplace_order_items RENAME TO k8_itens_reais",
        );
        await c.query(
          "CREATE VIEW public.marketplace_order_items AS SELECT * FROM public.k8_itens_reais",
        );
        await c.query(
          `DO $g$ BEGIN IF (SELECT relkind FROM pg_class WHERE oid = 'public.marketplace_order_items'::regclass) <> 'v' THEN RAISE EXCEPTION 'a mutacao nao aplicou: vista no lugar da tabela'; END IF; END $g$`,
        );
        await c.query(`SET LOCAL ROLE ${P.ro}`);
        return (await c.query(SQL_8K)).rows;
      } finally {
        await c.query("ROLLBACK");
      }
    });
    await exigirReprovadas("N9", rows, [I.relI, I.cPed, I.cIte, I.vazia]);
    assert.equal(linha(rows, I.relI).vivo, "v");
    assert.equal(campos(linha(rows, I.metaI)).relkind, "v");
    assert.equal(linha(rows, I.relO).vivo, "r");
    await exigirPositiva("N9 depois do ROLLBACK", await rodar(vazio));
    ok(
      "N9 uma VIEW de mesmo nome no lugar de marketplace_order_items (todo o resto igual): reprova 'marketplace_order_items: relkind' (vivo = v) e, como não é tabela comum, a vazia NÃO é provada (a vista lê 0)",
    );
  }

  // ------------------------------------------------------------------ L1
  {
    const db = await clonar("l1");
    await semear(db, { pedidos: pedidosOk() });
    await mutar(
      db,
      "L1: pedido A divergente",
      `UPDATE public.marketplace_orders SET subtotal = 1.00 WHERE id = '${PED.A}'`,
      `(SELECT subtotal FROM public.marketplace_orders WHERE id = '${PED.A}') = 1.00`,
    );
    // controle: quem VÊ tudo enxerga a divergência
    await exigirReprovadas("L1 controle (bypass)", await rodar(db), [I.div]);
    // o papel sem bypass só enxerga o pedido B (e os itens dele): o A fica ESCONDIDO
    await mutar(
      db,
      "L1: política mostra só o pedido B (pedidos)",
      `CREATE POLICY k8_so_b ON public.marketplace_orders FOR SELECT TO ${P.cego} USING (id = '${PED.B}')`,
      `EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.marketplace_orders'::regclass AND polname = 'k8_so_b')`,
    );
    await mutar(
      db,
      "L1: política mostra só os itens do pedido B",
      `CREATE POLICY k8_so_b ON public.marketplace_order_items FOR SELECT TO ${P.cego} USING (order_id = '${PED.B}')`,
      `EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.marketplace_order_items'::regclass AND polname = 'k8_so_b')`,
    );
    const rows = await rodar(db, { papel: P.cego });
    // COM DADOS e RLS ativa: a 8k (A1) REPROVA, nas linhas da RLS, e NUNCA positiva
    await exigirReprovadas("L1", rows, [I.rlsO, I.rlsI]);
    assert.equal(
      linha(rows, I.div).vivo,
      "0",
      "o pedido A divergente está escondido",
    );
    assert.equal(linha(rows, I.cPed).ok, true);
    // a 8c LEGADA aceitava essa visão parcial (positiva): é o que a 8k fecha
    const r8c = await rodar(db, { papel: P.cego, sql: SQL_8C });
    assert.deepEqual(reprovadas(r8c), [], "a 8c aceitava a parte visível");
    ok(
      "L1 COM DADOS e RLS ativa (papel sem BYPASSRLS vê só o pedido B, o A divergente fica escondido): a 8k REPROVA nas duas linhas row_security_active (a 8c legada aceitava): papel sem bypass e com RLS ativa nunca fecha a conferência",
    );
  }

  // ------------------------------------------------------------------ N12
  {
    // (a) pedidos: vazios e VISÍVEIS (RLS desligada); itens: com linhas ESCONDIDAS pela RLS
    const a = await clonar("n12a");
    await semear(a, {
      itensAvulsos: [
        ["f0000000-0000-4000-8000-0000000000f2", 2, "7.77"],
        ["f0000000-0000-4000-8000-0000000000f3", 1, "13.13"],
      ],
    });
    await desligarRls(a, "N12a", ["marketplace_orders"]);
    await mutar(
      a,
      `N12a: política que esconde os itens de ${P.cego}`,
      `CREATE POLICY k8_oculta ON public.marketplace_order_items FOR SELECT TO ${P.cego} USING (false)`,
      `EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.marketplace_order_items'::regclass AND polname = 'k8_oculta')`,
    );
    const ra = await rodar(a, { papel: P.cego });
    await exigirReprovadas("N12a", ra, [I.rlsI, I.cPed, I.cIte, I.vazia]);
    assert.equal(campos(linha(ra, I.metaO)).row_security_active, "false");
    assert.equal(campos(linha(ra, I.metaI)).linhas, "0");
    assert.equal(
      await contar(a, "marketplace_order_items"),
      2,
      "os itens EXISTEM",
    );
    // (b) o inverso: itens vazios e visíveis; pedidos com linhas escondidas
    const b = await clonar("n12b");
    await semear(b, {
      pedidos: [{ id: PED.A, subtotal: "0.00", itens: [] }],
    });
    await desligarRls(b, "N12b", ["marketplace_order_items"]);
    await mutar(
      b,
      `N12b: política que esconde os pedidos de ${P.cego}`,
      `CREATE POLICY k8_oculta ON public.marketplace_orders FOR SELECT TO ${P.cego} USING (false)`,
      `EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.marketplace_orders'::regclass AND polname = 'k8_oculta')`,
    );
    const rb = await rodar(b, { papel: P.cego });
    await exigirReprovadas("N12b", rb, [I.rlsO, I.cPed, I.cIte, I.vazia]);
    assert.equal(campos(linha(rb, I.metaO)).linhas, "0");
    assert.equal(await contar(b, "marketplace_orders"), 1, "o pedido EXISTE");
    ok(
      "N12 a vazia é CONJUNTA: pedidos vazios e visíveis + itens com linhas ESCONDIDAS pela RLS (e o inverso) → reprova 'vazia provada' e os dois controles; uma tabela provada não vale pela outra",
    );
  }

  // ------------------------------------------------------------------ N13
  {
    // filho por HERANÇA com linhas sob um pai vazio: a contagem no pai (sem ONLY) inclui o filho
    const db = await clonar("n13");
    await mutar(
      db,
      "N13: tabela filha por herança de marketplace_orders",
      "CREATE TABLE public.k8_pedidos_filho () INHERITS (public.marketplace_orders)",
      "EXISTS (SELECT 1 FROM pg_inherits WHERE inhparent = 'public.marketplace_orders'::regclass)",
    );
    await usar(db, (c) =>
      c.query(
        `INSERT INTO public.k8_pedidos_filho (id, customer_name, customer_data, total, subtotal)
         VALUES ('${PED.A}', 'Cliente 8k', '{}'::jsonb, 0, 0)`,
      ),
    );
    assert.equal(
      await usar(
        db,
        async (c) =>
          (
            await c.query(
              "SELECT count(*)::int AS n FROM ONLY public.marketplace_orders",
            )
          ).rows[0].n,
      ),
      0,
      "guarda: o PAI, sozinho (ONLY), está vazio",
    );
    const rows = await rodar(db);
    await exigirReprovadas("N13", rows, [I.cIte]);
    assert.equal(
      linha(rows, I.cPed).vivo,
      ">0",
      "a contagem no pai inclui o filho",
    );
    assert.equal(
      linha(rows, I.vazia).vivo,
      "nao se aplica (ha linhas visiveis)",
    );
    // tabela PARTICIONADA (relkind p) no lugar da comum, numa transação com ROLLBACK
    const particionada = await usar(vazio, async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(
          "ALTER TABLE public.marketplace_orders RENAME TO k8_pedidos_reais",
        );
        await c.query(
          "CREATE TABLE public.marketplace_orders (id uuid, subtotal numeric(10,2)) PARTITION BY HASH (id)",
        );
        await c.query(
          `DO $g$ BEGIN IF (SELECT relkind FROM pg_class WHERE oid = 'public.marketplace_orders'::regclass) <> 'p' THEN RAISE EXCEPTION 'a mutacao nao aplicou: tabela particionada'; END IF; END $g$`,
        );
        await c.query(`SET LOCAL ROLE ${P.ro}`);
        return (await c.query(SQL_8K)).rows;
      } finally {
        await c.query("ROLLBACK");
      }
    });
    await exigirReprovadas("N13 particionada", particionada, [
      I.relO,
      I.cPed,
      I.cIte,
      I.vazia,
    ]);
    assert.equal(linha(particionada, I.relO).vivo, "p");
    await exigirPositiva("N13 depois do ROLLBACK", await rodar(vazio));
    ok(
      "N13 filho por herança com linhas sob um pai vazio: a contagem (sem ONLY) o inclui, NÃO vira vazia provada; tabela PARTICIONADA (relkind p) no lugar da comum reprova 'relkind' e a vazia",
    );
  }

  // ------------------------------------------------------------------ N14
  {
    const db = await clonar("n14");
    await semear(db, { pedidos: pedidosOk() });
    await usoDeExtensions(db, P.dono);
    for (const t of TABELAS) {
      await mutar(
        db,
        `N14: ${P.dono} dono de ${t}`,
        `ALTER TABLE public.${t} OWNER TO ${P.dono}`,
        `${DONO_DE(t)} = '${P.dono}'`,
      );
      await mutar(
        db,
        `N14: FORCE em ${t}`,
        `ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY`,
        `${FORCE_DE(t)} IS TRUE`,
      );
      await mutar(
        db,
        `N14: política USING false para o dono em ${t}`,
        `CREATE POLICY k8_nega ON public.${t} FOR SELECT TO ${P.dono} USING (false)`,
        `EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.${t}'::regclass AND polname = 'k8_nega')`,
      );
    }
    const rows = await rodar(db, { papel: P.dono });
    await exigirReprovadas("N14", rows, [
      I.rlsO,
      I.rlsI,
      I.cPed,
      I.cIte,
      I.vazia,
    ]);
    assert.equal(campos(linha(rows, I.metaO)).dono, "true");
    assert.equal(campos(linha(rows, I.metaO)).rls_forcada, "true");
    assert.equal(
      await contar(db, "marketplace_orders"),
      3,
      "as linhas EXISTEM",
    );
    ok(
      "N14 o DONO com FORCE e política USING (false), com 3 pedidos que existem: lê 0, a RLS vale para ele → reprova as duas row_security_active, os controles e a vazia",
    );
  }

  // ------------------------------------------------------------------ N15
  {
    const r = await tentar(vazio, {
      papel: P.cego,
      antes: ["SET row_security = off"],
    });
    await exigirFalhaAlta("N15", r, "42501", /row-level security/);
    // controle: o papel com BYPASSRLS não é afetado pelo row_security = off
    const rb = await rodar(vazio, {
      papel: P.ro,
      antes: ["SET row_security = off"],
    });
    await exigirPositiva("N15 controle (bypass com row_security=off)", rb);
    ok(
      "N15 papel sem BYPASSRLS com row_security = off e RLS aplicável: o statement INTEIRO falha (42501, query would be affected by row-level security policy), sem veredito → não positivo; o papel com bypass segue positivo",
    );
  }

  // ------------------------------------------------------------------ N16
  {
    const db = await clonar("n16");
    // (a) TABELAS TEMPORÁRIAS de mesmo nome (a temporária vem ANTES no search_path), com linhas
    const temporarias = [
      "CREATE TEMP TABLE marketplace_orders (id uuid, subtotal numeric(10,2))",
      "CREATE TEMP TABLE marketplace_order_items (id uuid, order_id uuid, quantity bigint, price double precision)",
      "INSERT INTO pg_temp.marketplace_orders VALUES ('f0000000-0000-4000-8000-0000000000f9', 1)",
    ];
    const ra = await rodar(db, { antes: temporarias });
    await exigirPositiva("N16 temporárias", ra);
    assert.equal(linha(ra, I.vazia).vivo, "VAZIA PROVADA");
    assert.equal(
      linha(ra, I.tIPreco).vivo,
      "numeric(10,2)",
      "o tipo é o da tabela de public, não o da temporária (double precision)",
    );
    // (b) um SCHEMA à frente no search_path com tabelas de mesmo nome e tipos errados
    await mutar(
      db,
      "N16: schema k8_outro com tabelas de mesmo nome",
      `CREATE SCHEMA k8_outro;
       CREATE TABLE k8_outro.marketplace_orders (id text, subtotal real);
       CREATE TABLE k8_outro.marketplace_order_items (id text, order_id text, quantity bigint, price real)`,
      "to_regclass('k8_outro.marketplace_orders') IS NOT NULL AND to_regclass('k8_outro.marketplace_order_items') IS NOT NULL",
    );
    const rb = await rodar(db, {
      antes: ["SET search_path = k8_outro, public"],
    });
    await exigirPositiva("N16 schema à frente", rb);
    assert.equal(linha(rb, I.tOId).vivo, "uuid");
    assert.equal(linha(rb, I.tOSub).vivo, "numeric(10,2)");
    ok(
      "N16 tabelas de mesmo nome antes no search_path (temporárias com tipo errado e um schema com text/real): os metadados e as contagens continuam sendo os de public (tipos uuid/numeric(10,2); positiva)",
    );
  }

  // ------------------------------------------------------------------ A5: tipos antes do lote 92-202
  {
    const nome = `k8_${SUF}_pre1192`.slice(0, 60);
    await montarBase(nome, (f) => f < "20261192");
    const rows = await rodar(nome);
    await exigirPositiva("tipos pré-20261192", rows);
    for (const [item, tipo] of Object.entries(TIPOS_MEDIDOS))
      assert.equal(
        linha(rows, item).vivo,
        tipo,
        `${item} antes do lote 92-202`,
      );
    console.log(
      `  [A5] tipos medidos com as migrations só até a 20261191 = árvore inteira: ${Object.entries(
        TIPOS_MEDIDOS,
      )
        .map(([i, t]) => `${i.replace(": tipo", "")}=${t}`)
        .join("; ")}`,
    );
    ok(
      "tipos medidos com as migrations aplicadas só até ANTES da 20261192 (o estado da Savy hoje) são IGUAIS aos da árvore inteira, e a 8k é positiva nesse banco vazio",
    );
  }

  // ------------------------------------------------------------------ ponta a ponta
  {
    const api = await subirApi();
    const env = (extra) => ({
      CONFERIR_BANCO_API_BASE: api.base,
      PROJETO: "savy",
      CONSULTA: NOME_8K,
      SUPABASE_ACCESS_TOKEN_SAVY: "tk-teste",
      GITHUB_SHA: SHA40,
      ...extra,
    });
    const executar = async (db, papel) => {
      api.estado.db = db;
      api.estado.papel = papel;
      return rodarScript(env({}));
    };
    const doLog = (saida) => PORTAO.lerVeredicto(saida, NOME_8K);
    const noPortao = async (saida, conclusao) =>
      (await portaoComLog(saida, conclusao)).estado;
    try {
      // E1: vazia provada → saída 0, veredito com rol=ok, portão POSITIVA
      const e1 = await executar(vazio, P.ro);
      assert.equal(e1.codigo, 0, e1.saida);
      const v1 = doLog(e1.saida);
      assert.deepEqual(v1, {
        ref: REF_SAVY,
        sha: SHA40,
        linhas: 20,
        okFalse: 0,
        naoBooleano: 0,
        rol: "ok",
      });
      assert.equal(await noPortao(e1.saida, "success"), "POSITIVA");
      assert.match(e1.saida, /VAZIA PROVADA/);
      assert.ok(!SEGREDOS.some((s) => e1.saida.includes(s)));

      // E2: vazia mas o papel é cego pela RLS → o script SAI 0 (a consulta rodou), o
      // veredito traz ok_false=3 e o portão dá NEGATIVA — nunca POSITIVA
      const e2 = await executar(vazio, P.cego);
      assert.equal(e2.codigo, 0, e2.saida);
      const v2 = doLog(e2.saida);
      assert.equal(v2.okFalse, 5);
      assert.equal(v2.rol, "ok");
      assert.equal(await noPortao(e2.saida, "success"), "NEGATIVA");
      assert.match(e2.saida, /ZERO NAO PROVADO/);

      // E3: tabela ausente (clone próprio, renomeada de verdade) → HTTP 400, saída 1,
      // NENHUMA linha VEREDITO-CONSULTA; run vermelho; o portão fica SEM_EVIDENCIA
      const ausente = await clonar("ausente");
      await mutar(
        ausente,
        "E3: tabela marketplace_order_items ausente",
        "ALTER TABLE public.marketplace_order_items RENAME TO k8_ausente",
        "to_regclass('public.marketplace_order_items') IS NULL",
      );
      const e3 = await executar(ausente, P.ro);
      assert.equal(e3.codigo, 1, e3.saida);
      assert.match(e3.saida, /FALHOU: .*HTTP 400.*does not exist/s);
      assert.ok(!e3.saida.includes("VEREDITO-CONSULTA"), e3.saida);
      assert.equal(doLog(e3.saida), null);
      assert.equal(await noPortao(e3.saida, "failure"), "SEM_EVIDENCIA");
      assert.equal(await noPortao(e3.saida, "success"), "SEM_EVIDENCIA");

      // E4: papel sem NENHUM SELECT → 42501, saída 1, sem veredito
      const semSelect = await clonar("e4");
      await usoDeExtensions(semSelect, P.semsel);
      const e4 = await executar(semSelect, P.semsel);
      assert.equal(e4.codigo, 1, e4.saida);
      assert.match(e4.saida, /permission denied for table/);
      assert.ok(!e4.saida.includes("VEREDITO-CONSULTA"));
      assert.equal(await noPortao(e4.saida, "failure"), "SEM_EVIDENCIA");

      // E5: com dados divergentes → saída 0, veredito NEGATIVA (ok_false=1)
      const div = await clonar("e5");
      await semear(div, { pedidos: pedidosOk() });
      await mutar(
        div,
        "E5: subtotal do pedido B adulterado",
        `UPDATE public.marketplace_orders SET subtotal = 999.99 WHERE id = '${PED.B}'`,
        `(SELECT subtotal FROM public.marketplace_orders WHERE id = '${PED.B}') = 999.99`,
      );
      const e5 = await executar(div, P.ro);
      assert.equal(e5.codigo, 0, e5.saida);
      assert.equal(doLog(e5.saida).okFalse, 1);
      assert.equal(await noPortao(e5.saida, "success"), "NEGATIVA");
      ok(
        "ponta a ponta (conferir-banco.cjs de verdade, HTTP local, papel de leitura): vazia provada → rol=ok, 20 linhas, portão POSITIVA; vazia sob RLS → ok_false=5, NEGATIVA; tabela ausente e papel sem SELECT → saída 1, SEM linha VEREDITO, SEM_EVIDENCIA; divergência → NEGATIVA",
      );
    } finally {
      await api.parar();
    }
  }

  console.log(`\n[subtotal-vazia-provada-viva] ${resultados} provas ok`);
}

function to_regclass_ok(r) {
  return r.rows[0].t !== null;
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
