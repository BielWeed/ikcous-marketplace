"use strict";

/**
 * PROVA VIVA da migration 20261207000000_o_contador_duplicado_do_cupom_morre.sql (apaga
 * `public.coupons.used_count`; politica P4 do dono) e do rollback dela, num Postgres
 * EFEMERO local -- nada de rede, nada de loja.
 *
 * O QUE ESTA PROVA AFIRMA, EXECUTANDO (cada caso num banco CLONADO do estado "pre", a
 * arvore inteira de migrations MENOS a 20261207000000, que e o estado de uma loja antes do
 * apply; a fotografia do antes/depois cobre colunas, dados, funcoes, politicas, ACL e
 * constraints de `coupons`):
 *  POSITIVOS
 *   zero      tudo 0: aplica, a coluna some, as outras colunas, os dados, `usage_count`,
 *             o corpo de TODA funcao de public (inclusive validate_coupon_secure_v2 e
 *             devolver_cupons_de_pedidos_mortos), politicas, constraints e ACL ficam
 *             IGUAIS; a tabela continua aceitando insert e select *; uma segunda aplicacao
 *             e no-op; o texto com fim de linha CRLF e o envelope do db-apply
 *             (BEGIN ... COMMIT) tambem aplicam.
 *   atomico   uma falha DEPOIS do DROP (divisao por zero na mesma consulta) desfaz tudo:
 *             a coluna continua la; e BEGIN ... ROLLBACK (a prova do workflow) tambem.
 *   rollback  apos a migration, o rollback recria a coluna integer, aceita NULL, DEFAULT 0,
 *             IDENTICA a do baseline (comparada em pg_attribute/pg_attrdef) e todas as
 *             linhas voltam com 0; repetido e no-op; recusa (ROLLBACK_20261207) se a coluna
 *             ja existe com outra forma.
 *  RECUSAS (cada uma: mensagem que NOMEIA o motivo e NADA gravado -- a fotografia depois
 *   e igual a de antes, a coluna continua la com os mesmos valores)
 *   valor     used_count = 3 em uma linha;  nulo   used_count NULL em uma linha;
 *   visao     visao que cita a coluna (por nome e por select *);  funcao  funcao plpgsql
 *   que cita used_count no corpo;  gerada  coluna GERADA que cita used_count (a dependencia
 *   mora no pg_attrdef da OUTRA coluna: so o default da PROPRIA coluna e' ignorado);
 *   forma     tipo, default ou NOT NULL diferentes do baseline;  rls  seguranca por linha
 *   valendo para o papel que aplica (a contagem so veria as linhas visiveis a ele);
 *   usage     `usage_count` ausente.
 *  CONCORRENCIA (duas conexoes reais)
 *   corrida   uma gravacao em used_count (valor 7) em transacao ABERTA, a migration espera a
 *             trava; a gravacao commita; a migration recusa (7) e o valor continua la. Duas
 *             variantes: UPDATE (segurado pelo LOCK e tambem pelo FOR SHARE) e INSERT de linha
 *             nova (so o LOCK da tabela a segura; e' o que o mutante "sem LOCK" prova).
 *   timeout   uma transacao segurando `coupons` por mais de 5 s: a migration falha com
 *             lock_timeout (55P03), sem gravar nada.
 *   rr        o ENVELOPE de producao (aplicar-migrations.yml): BEGIN ISOLATION LEVEL REPEATABLE
 *             READ, uma leitura de `coupons` (a foto da impressao digital, ANTES do LOCK), a
 *             migration, COMMIT. Sem concorrente aplica. Com um UPDATE used_count = 7
 *             gravado DEPOIS da foto e ANTES da trava, a migration RECUSA (40001, o FOR SHARE
 *             do pre-voo) e a coluna e o 7 continuam la (a prova `corrida`, em READ
 *             COMMITTED, nao enxerga isso: la a contagem ja le o dado novo).
 *  MUTANTES (cada guarda retirada do texto da migration/rollback deixa um caso VERMELHO; a
 *   saida vermelha de cada um e' impressa): sem LOCK (corrida com INSERT); sem lock_timeout; sem (a) usage_count;
 *   sem o FOR SHARE (envelope REPEATABLE READ); sem (b) forma; sem (c) RLS; sem (d) dependentes; (d) voltando a ignorar todo pg_attrdef;
 *   (d) sem ignorar o default da propria coluna; sem (e) funcoes; sem (f) valores; (f) com
 *   COALESCE (NULL vira 0); sem o RETURN da coluna ja ausente; sem o pos-voo; rollback sem a
 *   conferencia de forma. E a CAMADA FINAL: sem o item (d), o DROP sem CASCADE ainda recusa
 *   (Postgres 2BP01, nada gravado); sem (d) E com CASCADE a coluna gerada some junto.
 *
 * LIMITES DECLARADOS: (1) o Postgres e o 17 LOCAL; o Postgres 15/17 da Supabase, o papel
 * `postgres` real e a ACL real das lojas nao foram medidos aqui. (2) O envelope do db-apply
 * e simulado por BEGIN [ISOLATION LEVEL REPEATABLE READ] / foto / COMMIT em texto, nao pelo
 * aplicar-migrations.yml nem pelo impressao-digital.sql de verdade. Um INSERT com used_count
 * explicito diferente de zero entre a foto e o LOCK NAO e visto (risco residual aceito,
 * documentado na migration): a prova nao o exercita. (3) Politica, gatilho e
 * visao que citam a coluna sao recusados pelo item (d) (pg_depend); a prova nao distingue
 * esses tres entre si, so a visao e a coluna gerada sao exercitadas.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres:...@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/contador-duplicado-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp --
 * Os caminhos vem do proprio repositorio (as duas migrations) e os trechos regex dos
 * mutantes vem de constantes deste arquivo, nunca de entrada de rede. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
const ARQ = "20261207000000_o_contador_duplicado_do_cupom_morre.sql";
const ARQ_RB = `rollback-manual-${ARQ}`;
const lerLF = (arq) =>
  fs.readFileSync(path.join(MIGRATIONS, arq), "utf8").replace(/\r\n/g, "\n");
const MIG = lerLF(ARQ);
const RB = lerLF(ARQ_RB);

const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const P = { dono: `cd_rls_${SUF}` };

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
let PRE = null;
async function clonar(rotulo, de = PRE) {
  const nome = `cd_${SUF}_${clones.length}_${rotulo}`.slice(0, 60);
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
/** Monta um banco NOVO com as migrations que passam no filtro, pelos mesmos scripts do
 * rpc-ci.yml, num diretorio temporario exclusivo desta execucao. */
async function montarBase(nome, filtro) {
  await usar("template1", (a) => a.query(`CREATE DATABASE "${nome}"`));
  clones.push(nome);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-"));
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
  return nome;
}

// ---------------------------------------------------------------------------
// Dados, fotografia e aplicacao
// ---------------------------------------------------------------------------
/** Tres cupons com usage_count DIFERENTES (o dado que ja existia antes da migration). */
async function semear(db) {
  await usar(db, (c) =>
    c.query(`INSERT INTO public.coupons (code, type, value, usage_limit, usage_count) VALUES
      ('CJ1', 'fixed', 10, 5, 5), ('CJ2', 'percentage', 15, NULL, 0), ('CJ3', 'fixed', 3, 2, 2)`),
  );
}
const ATRIBUTOS = `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull,
       pg_get_expr(ad.adbin, ad.adrelid) AS padrao, a.attgenerated, a.attidentity,
       a.attcollation::regcollation::text AS colacao, a.attstorage, a.attacl::text AS acl
  FROM pg_attribute a
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
 WHERE a.attrelid = 'public.coupons'::regclass AND a.attnum > 0 AND NOT a.attisdropped`;
/** A fotografia de `coupons` e das funcoes de public. `usedShape` e os valores de
 * used_count so existem enquanto a coluna existe. */
async function fotografia(db) {
  return usar(db, async (c) => {
    const q = async (sql) => (await c.query(sql)).rows;
    const atributos = await q(`${ATRIBUTOS} ORDER BY a.attname`);
    const usado = atributos.find((a) => a.attname === "used_count") ?? null;
    return {
      usedExiste: usado !== null,
      usedShape: usado,
      outrasColunas: atributos.filter((a) => a.attname !== "used_count"),
      dados: await q(
        `SELECT code, (to_jsonb(c) - 'used_count')::text AS linha FROM public.coupons c ORDER BY code`,
      ),
      usedValores: usado
        ? await q(
            `SELECT code, (to_jsonb(c) -> 'used_count')::text AS v FROM public.coupons c ORDER BY code`,
          )
        : null,
      usage: (
        await q(
          `SELECT string_agg(code || '=' || usage_count, ',' ORDER BY code) AS u FROM public.coupons`,
        )
      )[0].u,
      funcoes: (
        await q(`SELECT md5(string_agg(p.oid::regprocedure::text || '|' || p.prosrc || '|'
                 || coalesce(p.proacl::text, '') || '|' || p.proowner::regrole::text,
                 E'\\n' ORDER BY p.oid::regprocedure::text)) AS h
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public'`)
      )[0].h,
      corposChave: await q(
        `SELECT p.proname, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN ('validate_coupon_secure_v2', 'devolver_cupons_de_pedidos_mortos')
          ORDER BY p.proname`,
      ),
      politicas: await q(
        `SELECT polname, polcmd, polroles::regrole[]::text AS roles,
                pg_get_expr(polqual, polrelid) AS q, pg_get_expr(polwithcheck, polrelid) AS w
           FROM pg_policy WHERE polrelid = 'public.coupons'::regclass ORDER BY polname`,
      ),
      restricoes: await q(
        `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'public.coupons'::regclass ORDER BY conname`,
      ),
      indices: await q(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'coupons' ORDER BY indexname`,
      ),
      acl: (
        await q(
          `SELECT relacl::text AS a, relrowsecurity, relforcerowsecurity FROM pg_class
            WHERE oid = 'public.coupons'::regclass`,
        )
      )[0],
    };
  });
}
/** Aplica um texto SQL como o aplicar-migrations.cjs: UMA consulta com o arquivo todo. */
async function aplicar(db, texto, { papel = null } = {}) {
  const c = new Client({ connectionString: urlDe(db) });
  await c.connect();
  try {
    if (papel) await c.query(`SET ROLE ${papel}`);
    await c.query(texto);
    return { ok: true };
  } catch (erro) {
    return { erro };
  } finally {
    await c.end().catch(() => {});
  }
}
const crlf = (s) => s.replace(/\n/g, "\r\n");

function recusou(r, trecho, rotulo) {
  assert.ok(
    r.erro,
    `${rotulo}: devia RECUSAR e aplicou (a coluna foi apagada com dado ou dependente por perto)`,
  );
  assert.equal(r.erro.code, "P0001", `${rotulo}: ${r.erro.message}`);
  assert.match(r.erro.message, trecho, `${rotulo}: recusou por OUTRO motivo`);
}
async function nadaGravado(db, antes, rotulo) {
  const depois = await fotografia(db);
  assert.equal(depois.usedExiste, true, `${rotulo}: a coluna foi apagada`);
  assert.deepEqual(depois, antes, `${rotulo}: algo mudou no banco`);
}

// ---------------------------------------------------------------------------
// Mutacao do texto da migration/rollback
// ---------------------------------------------------------------------------
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function trocar(sql, de, para) {
  assert.ok(sql.includes(de), `o trecho a mutar nao existe: ${de.slice(0, 80)}`);
  const novo = sql.replace(de, () => para);
  assert.notEqual(novo, sql);
  return novo;
}
/** Troca por `NULL;` o RAISE EXCEPTION cuja mensagem comeca em `inicio`. */
function semRaise(sql, inicio) {
  const re = new RegExp(
    `RAISE EXCEPTION '${escRe(inicio)}[^']*'(?:, [^;]*)?;`,
  );
  assert.ok(re.test(sql), `nao achei o RAISE "${inicio}"`);
  return sql.replace(re, "NULL;");
}
const T = {
  lock: "  LOCK TABLE public.coupons IN SHARE ROW EXCLUSIVE MODE;\n",
  lockTimeout: "SET LOCAL lock_timeout = '5s';\n",
  forShare: "  PERFORM 1 FROM public.coupons FOR SHARE;\n",
  retorno: "    RETURN; -- ja apagada: reaplicacao, nada a conferir nem a fazer\n",
  drop: "ALTER TABLE public.coupons DROP COLUMN IF EXISTS used_count;",
  nullComo0: "WHERE used_count IS DISTINCT FROM 0'",
  // o bloco que exclui SO o default da propria coluna (item d)
  exclusao: `     AND NOT (
       d.classid = 'pg_attrdef'::regclass
       AND EXISTS (
         SELECT 1 FROM pg_attrdef ad
          WHERE ad.oid = d.objid
            AND ad.adrelid = d.refobjid
            AND ad.adnum = d.refobjsubid
       )
     );`,
};
const MSG = {
  usage: "PREFLIGHT_20261207: public.coupons.usage_count nao existe",
  forma: "PREFLIGHT_20261207: public.coupons.used_count nao tem a forma",
  rls: "PREFLIGHT_20261207: a seguranca por linha vale",
  dep: "PREFLIGHT_20261207: % objeto(s) dependem",
  fn: "PREFLIGHT_20261207: % funcao(oes) de public citam",
  val: "PREFLIGHT_20261207: used_count tem % linha(s)",
  pos: "POSVOO_20261207: public.coupons.used_count ainda existe",
  rb: "ROLLBACK_20261207: public.coupons.used_count existe mas nao tem a forma",
};

/** Um MUTANTE tem de ser PEGO: o caso, rodado com o texto mutado, LANCA AssertionError. */
async function mutante(rotulo, caso, sqlMutado) {
  let pego = null;
  try {
    await caso(sqlMutado);
  } catch (e) {
    assert.ok(
      e instanceof assert.AssertionError,
      `${rotulo}: o mutante falhou por erro que nao e de asserção: ${e && e.stack}`,
    );
    pego = e;
  }
  assert.ok(pego, `${rotulo}: o MUTANTE passou despercebido (a prova ficaria VERDE)`);
  console.log(
    `     mutante "${rotulo}" -> VERMELHO: ${String(pego.message).split("\n")[0].slice(0, 200)}`,
  );
  ok(`mutante "${rotulo}" deixa a prova VERMELHA`);
}

// ---------------------------------------------------------------------------
// Os casos (cada um recebe o texto da migration, para os mutantes)
// ---------------------------------------------------------------------------
async function casoZero(sql = MIG) {
  const db = await clonar("zero");
  await semear(db);
  const antes = await fotografia(db);
  assert.equal(antes.usedExiste, true);
  const r1 = await aplicar(db, sql);
  assert.ok(!r1.erro, `aplicar com tudo 0 falhou: ${r1.erro?.message}`);
  const depois = await fotografia(db);
  assert.equal(depois.usedExiste, false, "a coluna tem de sumir");
  assert.deepEqual(depois.outrasColunas, antes.outrasColunas, "outras colunas");
  assert.deepEqual(depois.dados, antes.dados, "dados das outras colunas");
  assert.equal(depois.usage, "CJ1=5,CJ2=0,CJ3=2", "usage_count intacto");
  assert.equal(depois.usage, antes.usage);
  assert.equal(depois.funcoes, antes.funcoes, "corpo/ACL de funcao de public");
  assert.deepEqual(depois.corposChave, antes.corposChave);
  assert.equal(depois.corposChave.length, 2);
  assert.deepEqual(depois.politicas, antes.politicas);
  assert.deepEqual(depois.restricoes, antes.restricoes);
  assert.deepEqual(depois.indices, antes.indices);
  assert.deepEqual(depois.acl, antes.acl);
  // a tabela continua usavel por quem nao conhece a coluna
  await usar(db, async (c) => {
    await c.query(
      `INSERT INTO public.coupons (code, type, value) VALUES ('CJ4', 'fixed', 1)`,
    );
    const r = await c.query(`SELECT * FROM public.coupons ORDER BY code`);
    assert.equal(r.rowCount, 4);
    assert.ok(!("used_count" in r.rows[0]));
  });
  return { db, antes, depois };
}
async function casoIdempotente(sql = MIG) {
  const { db } = await casoZero(sql);
  const meio = await fotografia(db);
  const r2 = await aplicar(db, sql);
  assert.ok(!r2.erro, `a 2a aplicacao (coluna ja ausente) falhou: ${r2.erro?.message}`);
  assert.deepEqual(await fotografia(db), meio, "a 2a aplicacao mudou algo");
}
async function casoValor(sql = MIG) {
  const db = await clonar("valor");
  await semear(db);
  await usar(db, (c) =>
    c.query(`UPDATE public.coupons SET used_count = 3 WHERE code = 'CJ2'`),
  );
  const antes = await fotografia(db);
  const r = await aplicar(db, sql);
  recusou(r, /used_count tem 1 linha\(s\) diferente\(s\) de 0/, "valor 3");
  await nadaGravado(db, antes, "valor 3");
  assert.equal(
    antes.usedValores.find((l) => l.code === "CJ2").v,
    "3",
    "o valor 3 continua la",
  );
}
async function casoNulo(sql = MIG) {
  const db = await clonar("nulo");
  await semear(db);
  await usar(db, (c) =>
    c.query(`UPDATE public.coupons SET used_count = NULL WHERE code = 'CJ3'`),
  );
  const antes = await fotografia(db);
  const r = await aplicar(db, sql);
  recusou(r, /used_count tem 1 linha\(s\) diferente\(s\) de 0 \(NULL conta\)/, "NULL");
  await nadaGravado(db, antes, "NULL");
}
async function casoVisao(sql = MIG) {
  for (const [rotulo, ddl] of [
    [
      "visao por nome",
      `CREATE VIEW public.vw_prova_cd AS SELECT code, used_count FROM public.coupons`,
    ],
    [
      "visao select *",
      `CREATE VIEW public.vw_prova_cd AS SELECT * FROM public.coupons`,
    ],
  ]) {
    const db = await clonar("visao");
    await semear(db);
    await usar(db, (c) => c.query(ddl));
    const antes = await fotografia(db);
    const r = await aplicar(db, sql);
    recusou(r, /objeto\(s\) dependem de public\.coupons\.used_count \(.*vw_prova_cd/, rotulo);
    await nadaGravado(db, antes, rotulo);
  }
}
async function casoFuncao(sql = MIG) {
  const db = await clonar("funcao");
  await semear(db);
  await usar(db, (c) =>
    c.query(`CREATE FUNCTION public.fn_prova_cd() RETURNS bigint LANGUAGE plpgsql AS $f$
      BEGIN RETURN (SELECT max(used_count) FROM public.coupons); END $f$`),
  );
  const antes = await fotografia(db);
  const r = await aplicar(db, sql);
  recusou(r, /funcao\(oes\) de public citam used_count \(fn_prova_cd\)/, "funcao");
  await nadaGravado(db, antes, "funcao");
}
async function preparaGerada() {
  const db = await clonar("gerada");
  await semear(db);
  await usar(db, (c) =>
    c.query(
      `ALTER TABLE public.coupons ADD COLUMN x integer GENERATED ALWAYS AS (used_count + 1) STORED`,
    ),
  );
  return db;
}
async function casoGerada(sql = MIG) {
  const db = await preparaGerada();
  const antes = await fotografia(db);
  const r = await aplicar(db, sql);
  recusou(r, /objeto\(s\) dependem de public\.coupons\.used_count/, "coluna gerada");
  await nadaGravado(db, antes, "coluna gerada");
}
/** A camada FINAL: seja qual for a causa, com coluna gerada nada pode ser gravado. */
async function casoGeradaRedeFinal(sql = MIG) {
  const db = await preparaGerada();
  const antes = await fotografia(db);
  const r = await aplicar(db, sql);
  assert.ok(r.erro, "com coluna gerada, aplicar tem de falhar (por qualquer motivo)");
  await nadaGravado(db, antes, "rede final (coluna gerada)");
}
async function casoForma(sql = MIG) {
  for (const [rotulo, ddl] of [
    ["tipo bigint", `ALTER TABLE public.coupons ALTER COLUMN used_count TYPE bigint`],
    ["default 5", `ALTER TABLE public.coupons ALTER COLUMN used_count SET DEFAULT 5`],
    ["NOT NULL", `ALTER TABLE public.coupons ALTER COLUMN used_count SET NOT NULL`],
  ]) {
    const db = await clonar("forma");
    await semear(db);
    await usar(db, (c) => c.query(ddl));
    const antes = await fotografia(db);
    const r = await aplicar(db, sql);
    recusou(r, /used_count nao tem a forma do baseline/, rotulo);
    await nadaGravado(db, antes, rotulo);
  }
}
async function casoRls(sql = MIG) {
  const db = await clonar("rls");
  await semear(db);
  await usar(db, async (c) => {
    await c.query(`UPDATE public.coupons SET used_count = 3 WHERE code = 'CJ1'`);
    await c.query(`DO $r$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${P.dono}') THEN
        CREATE ROLE ${P.dono} NOLOGIN;
      END IF; END $r$`);
    await c.query(`ALTER TABLE public.coupons OWNER TO ${P.dono}`);
    await c.query(`ALTER TABLE public.coupons FORCE ROW LEVEL SECURITY`);
    await c.query(`GRANT USAGE ON SCHEMA public TO ${P.dono}`);
    // controle: este papel, dono da tabela com FORCE e sem politica, NAO ve nenhuma linha
    await c.query(`SET ROLE ${P.dono}`);
    const v = await c.query(`SELECT count(*)::int AS n FROM public.coupons`);
    assert.equal(v.rows[0].n, 0, "controle: o papel dono (FORCE RLS) tem de ver 0 linhas");
    await c.query(`RESET ROLE`);
  });
  const antes = await fotografia(db);
  const r = await aplicar(db, sql, { papel: P.dono });
  recusou(r, /seguranca por linha vale para este papel/, "RLS");
  await nadaGravado(db, antes, "RLS");
}
async function casoUsage(sql = MIG) {
  const db = await clonar("usage");
  await semear(db);
  await usar(db, (c) => c.query(`ALTER TABLE public.coupons DROP COLUMN usage_count`));
  const r = await aplicar(db, sql);
  recusou(r, /PREFLIGHT_20261207: public\.coupons\.usage_count nao existe/, "usage_count ausente");
  await usar(db, async (c) => {
    const e = await c.query(
      `SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.coupons'::regclass
        AND attname = 'used_count' AND NOT attisdropped`,
    );
    assert.equal(e.rows[0].n, 1, "usage ausente: a coluna foi apagada");
  });
}
async function casoPosvoo(sql = MIG) {
  const db = await clonar("posvoo");
  await semear(db);
  const antes = await fotografia(db);
  // sem o DROP, quem pega e o pos-voo
  const r = await aplicar(db, trocar(sql, T.drop, "-- (DROP removido pelo caso)"));
  assert.ok(r.erro, "sem o DROP o pos-voo tem de reclamar");
  assert.equal(r.erro.code, "P0001", r.erro.message);
  assert.match(r.erro.message, /POSVOO_20261207: public\.coupons\.used_count ainda existe/);
  await nadaGravado(db, antes, "pos-voo");
}
async function casoAtomico(sql = MIG) {
  // (1) uma falha DEPOIS do DROP, na mesma consulta, desfaz tudo
  const db = await clonar("atomico");
  await semear(db);
  const antes = await fotografia(db);
  const r = await aplicar(db, `${sql}\nSELECT 1/0;\n`);
  assert.ok(r.erro, "a divisao por zero tem de falhar");
  assert.equal(r.erro.code, "22012", r.erro.message);
  await nadaGravado(db, antes, "falha depois do DROP");
  // (2) BEGIN ... ROLLBACK (a prova do workflow) tambem nao deixa rastro
  const r2 = await aplicar(db, `BEGIN;\n${sql}\nROLLBACK;\n`);
  assert.ok(!r2.erro, r2.erro?.message);
  await nadaGravado(db, antes, "BEGIN ... ROLLBACK");
  // (3) envelope do db-apply: BEGIN ... COMMIT aplica de verdade
  const r3 = await aplicar(db, `BEGIN;\n${sql}\nCOMMIT;\n`);
  assert.ok(!r3.erro, r3.erro?.message);
  assert.equal((await fotografia(db)).usedExiste, false);
}
async function casoCrlf(sql = MIG) {
  const db = await clonar("crlf");
  await semear(db);
  const r = await aplicar(db, crlf(sql));
  assert.ok(!r.erro, `CRLF falhou: ${r.erro?.message}`);
  assert.equal((await fotografia(db)).usedExiste, false);
}

/** `pg_stat_activity`: espera ate `ms` por UMA sessao bloqueada em trava neste banco. */
async function esperarBloqueio(db, ms) {
  const fim = Date.now() + ms;
  for (;;) {
    const bloqueada = await usar(db, async (c) =>
      (
        await c.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND pid <> pg_backend_pid()`,
        )
      ).rows[0].n,
    );
    if (bloqueada > 0) return;
    if (Date.now() > fim) throw new assert.AssertionError({ message: "a migration nao chegou a esperar a trava" });
    await new Promise((r) => setTimeout(r, 40));
  }
}
async function casoCorrida(sql = MIG) {
  const db = await clonar("corrida");
  await semear(db);
  const a = new Client({ connectionString: urlDe(db) });
  const b = new Client({ connectionString: urlDe(db) });
  await a.connect();
  await b.connect();
  try {
    await a.query("BEGIN");
    await a.query(`UPDATE public.coupons SET used_count = 7 WHERE code = 'CJ1'`);
    const emB = b.query(sql).then(
      () => ({ ok: true }),
      (erro) => ({ erro }),
    );
    await esperarBloqueio(db, 4000);
    await a.query("COMMIT");
    const r = await emB;
    recusou(r, /used_count tem 1 linha\(s\) diferente\(s\) de 0/, "corrida");
  } finally {
    await a.query("ROLLBACK").catch(() => {});
    await a.end().catch(() => {});
    await b.end().catch(() => {});
  }
  const depois = await fotografia(db);
  assert.equal(depois.usedExiste, true, "corrida: a coluna foi apagada com o 7");
  assert.equal(depois.usedValores.find((l) => l.code === "CJ1").v, "7", "o 7 continua la");
}
/** O que o LOCK da tabela protege e o FOR SHARE nao: uma LINHA NOVA. Um INSERT com used_count
 * = 7 em transacao aberta nao aparece na contagem (nao commitou) nem no FOR SHARE (nao existe
 * para ele); so a trava da tabela faz a migration esperar o COMMIT e ver o 7. Sem ela, o DROP
 * (que pede ACCESS EXCLUSIVE) espera o INSERT commitar e apaga a coluna COM o 7 dentro. */
async function casoCorridaInsert(sql = MIG) {
  const db = await clonar("corridains");
  await semear(db);
  const a = new Client({ connectionString: urlDe(db) });
  const b = new Client({ connectionString: urlDe(db) });
  await a.connect();
  await b.connect();
  try {
    await a.query("BEGIN");
    await a.query(
      `INSERT INTO public.coupons (code, type, value, used_count) VALUES ('CJ9', 'fixed', 1, 7)`,
    );
    const emB = b.query(sql).then(
      () => ({ ok: true }),
      (erro) => ({ erro }),
    );
    await esperarBloqueio(db, 4000);
    await a.query("COMMIT");
    const r = await emB;
    recusou(r, /used_count tem 1 linha\(s\) diferente\(s\) de 0/, "corrida com INSERT");
  } finally {
    await a.query("ROLLBACK").catch(() => {});
    await a.end().catch(() => {});
    await b.end().catch(() => {});
  }
  const depois = await fotografia(db);
  assert.equal(depois.usedExiste, true, "corrida com INSERT: a coluna foi apagada com o 7");
  assert.equal(depois.usedValores.find((l) => l.code === "CJ9").v, "7", "o 7 do INSERT continua la");
}
async function casoTimeout(sql = MIG) {
  const db = await clonar("timeout");
  await semear(db);
  const antes = await fotografia(db);
  const a = new Client({ connectionString: urlDe(db) });
  await a.connect();
  try {
    await a.query("BEGIN");
    await a.query(`UPDATE public.coupons SET usage_limit = 9 WHERE code = 'CJ2'`);
    const t0 = Date.now();
    const r = await aplicar(db, sql);
    const ms = Date.now() - t0;
    assert.ok(r.erro, "com a tabela presa a migration tem de falhar");
    assert.equal(r.erro.code, "55P03", `esperava lock_timeout: ${r.erro.code} ${r.erro.message}`);
    assert.ok(ms >= 4500 && ms < 20000, `lock_timeout de 5 s: levou ${ms} ms`);
  } finally {
    await a.query("ROLLBACK").catch(() => {});
    await a.end().catch(() => {});
  }
  await nadaGravado(db, antes, "lock_timeout");
}

/** Aplica `sql` como o envelope de producao (aplicar-migrations.yml): UMA transacao
 * REPEATABLE READ, a foto da impressao digital (uma leitura de `coupons`) ANTES do corpo,
 * COMMIT no fim. `entreFotoETrava` roda DEPOIS da foto e ANTES da migration, em OUTRA
 * conexao (autocommit). */
async function emEnvelopeRR(db, sql, entreFotoETrava = null) {
  const c = new Client({ connectionString: urlDe(db) });
  await c.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await c.query("SELECT count(*) FROM public.coupons"); // a foto: o snapshot nasce aqui
    if (entreFotoETrava) await entreFotoETrava();
    await c.query(sql);
    await c.query("COMMIT");
    return { ok: true };
  } catch (erro) {
    await c.query("ROLLBACK").catch(() => {});
    return { erro };
  } finally {
    await c.end().catch(() => {});
  }
}
async function casoRepeatableRead(sql = MIG) {
  // (1) o envelope sem concorrente aplica (o FOR SHARE nao atrapalha o caminho normal)
  const feliz = await clonar("rrok");
  await semear(feliz);
  const r1 = await emEnvelopeRR(feliz, sql);
  assert.ok(!r1.erro, `no envelope REPEATABLE READ sem concorrente falhou: ${r1.erro?.message}`);
  assert.equal((await fotografia(feliz)).usedExiste, false, "RR sem concorrente: a coluna tem de sumir");
  // (2) UPDATE gravado depois da foto e antes da trava: a foto velha diz "tudo 0"
  const db = await clonar("rr");
  await semear(db);
  const r = await emEnvelopeRR(db, sql, () =>
    usar(db, (c) => c.query(`UPDATE public.coupons SET used_count = 7 WHERE code = 'CJ1'`)),
  );
  assert.ok(
    r.erro,
    "RR: devia RECUSAR e aplicou (a coluna foi apagada com o 7 gravado depois da foto)",
  );
  assert.equal(r.erro.code, "40001", `RR: esperava 40001 (could not serialize): ${r.erro.code} ${r.erro.message}`);
  const depois = await fotografia(db);
  assert.equal(depois.usedExiste, true, "RR: a coluna foi apagada");
  assert.equal(depois.usedValores.find((l) => l.code === "CJ1").v, "7", "RR: o 7 continua la");
}

/** Rollback: devolve a coluna IDENTICA a do baseline. */
async function casoRollback(rb = RB) {
  const db = await clonar("rollback");
  await semear(db);
  const baseline = await fotografia(db); // a coluna como o baseline a deixou
  assert.equal(baseline.usedExiste, true);
  const r1 = await aplicar(db, MIG);
  assert.ok(!r1.erro, r1.erro?.message);
  assert.equal((await fotografia(db)).usedExiste, false);
  const r2 = await aplicar(db, rb);
  assert.ok(!r2.erro, `o rollback falhou: ${r2.erro?.message}`);
  const volta = await fotografia(db);
  assert.equal(volta.usedExiste, true);
  assert.deepEqual(volta.usedShape, baseline.usedShape, "a coluna recriada difere da do baseline (pg_attribute/pg_attrdef)");
  assert.deepEqual(volta.usedValores, baseline.usedValores, "valores de used_count");
  assert.ok(volta.usedValores.every((l) => l.v === "0"));
  assert.deepEqual(volta.outrasColunas, baseline.outrasColunas);
  assert.deepEqual(volta.dados, baseline.dados);
  assert.equal(volta.funcoes, baseline.funcoes);
  assert.deepEqual(volta.politicas, baseline.politicas);
  assert.deepEqual(volta.restricoes, baseline.restricoes);
  assert.deepEqual(volta.acl, baseline.acl);
  // repetido: no-op
  const r3 = await aplicar(db, rb);
  assert.ok(!r3.erro, r3.erro?.message);
  assert.deepEqual(await fotografia(db), volta);
  // e a migration volta a aplicar depois do rollback (ciclo completo)
  const r4 = await aplicar(db, MIG);
  assert.ok(!r4.erro, r4.erro?.message);
  assert.equal((await fotografia(db)).usedExiste, false);
}
async function casoRollbackRecusa(rb = RB) {
  const db = await clonar("rbrecusa");
  await semear(db);
  await usar(db, (c) => c.query(`ALTER TABLE public.coupons ALTER COLUMN used_count TYPE bigint`));
  const antes = await fotografia(db);
  const r = await aplicar(db, rb);
  recusou(r, /ROLLBACK_20261207: public\.coupons\.used_count existe mas nao tem a forma/, "rollback com forma errada");
  assert.deepEqual(await fotografia(db), antes);
}

async function main() {
  // Os papeis sao do CLUSTER; a prova cria um (nome unico) e o remove no finally.
  PRE = await montarBase(`cd_${SUF}_pre`, (nome) => nome !== ARQ);
  const sonda = await usar(PRE, async (c) => ({
    coluna: (
      await c.query(
        `SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'public.coupons'::regclass
          AND attname = 'used_count' AND NOT attisdropped`,
      )
    ).rows[0].n,
    cupons: (await c.query(`SELECT count(*)::int AS n FROM public.coupons`)).rows[0].n,
    eu: (await c.query(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`)).rows[0].rolsuper,
  }));
  assert.equal(sonda.coluna, 1, "precondicao: o estado pre TEM a coluna used_count");
  assert.equal(sonda.cupons, 0, "precondicao: o banco migrado comeca sem cupom");
  assert.equal(sonda.eu, true, "precondicao: a conexao da prova e superusuario");
  ok("estado PRE montado (arvore sem a 20261207): coluna used_count presente, sem cupom, conexao superusuario");

  // ----------------------------------------------------------- positivos
  await casoIdempotente();
  ok("zero: tudo 0 -> a coluna some; colunas, dados, usage_count (CJ1=5,CJ2=0,CJ3=2), corpo e ACL de TODA funcao de public, politicas, constraints, indices e ACL de coupons IGUAIS; insert e select * seguem; 2a aplicacao e no-op");
  await casoCrlf();
  ok("o texto com fim de linha CRLF (checkout Windows) aplica");
  await casoAtomico();
  ok("atomico: falha DEPOIS do DROP na mesma consulta desfaz tudo; BEGIN ... ROLLBACK nao deixa rastro; o envelope BEGIN ... COMMIT do db-apply aplica");

  // ----------------------------------------------------------- recusas
  await casoValor();
  ok("recusa com used_count = 3: mensagem nomeia a linha, NADA gravado (coluna e valor 3 intactos)");
  await casoNulo();
  ok("recusa com used_count NULL (NULL nao vale 0): NADA gravado");
  await casoVisao();
  ok("recusa com visao que cita a coluna (por nome e por select *): mensagem nomeia a visao, NADA gravado");
  await casoFuncao();
  ok("recusa com funcao plpgsql que cita used_count no corpo: mensagem nomeia a funcao, NADA gravado");
  await casoGerada();
  ok("recusa com coluna GERADA que cita used_count (o pg_attrdef de OUTRA coluna conta): NADA gravado");
  await casoForma();
  ok("recusa com forma diferente do baseline (bigint, default 5, NOT NULL): NADA gravado");
  await casoRls();
  ok("recusa com a seguranca por linha valendo para o papel (dono com FORCE RLS que ve 0 linhas, e 1 linha tem used_count = 3): NADA gravado");
  await casoUsage();
  ok("recusa com usage_count ausente: a coluna duplicada NAO e apagada");

  // ----------------------------------------------------------- concorrencia
  await casoCorrida();
  ok("corrida: gravacao de used_count = 7 em transacao aberta; a migration ESPERA a trava, ve o 7 depois do COMMIT e RECUSA; o 7 continua la");
  await casoCorridaInsert();
  ok("corrida com INSERT: linha nova com used_count = 7 em transacao aberta (o FOR SHARE nao a alcanca); a migration ESPERA a trava da tabela, ve o 7 depois do COMMIT e RECUSA; o 7 continua la");
  await casoTimeout();
  ok("timeout: tabela presa por outra transacao -> falha com lock_timeout (55P03) em ~5 s, NADA gravado");

  await casoRepeatableRead();
  ok("envelope REPEATABLE READ (como o aplicar-migrations.yml): sem concorrente aplica; com UPDATE used_count = 7 gravado DEPOIS da foto e ANTES da trava a migration RECUSA (40001) e a coluna e o 7 continuam la");

  // ----------------------------------------------------------- rollback
  await casoRollback();
  ok("rollback: recria a coluna IDENTICA a do baseline (pg_attribute/pg_attrdef), todas as linhas 0, o resto do banco igual; repetido e no-op; a migration volta a aplicar (ciclo completo)");
  await casoRollbackRecusa();
  ok("rollback recusa (ROLLBACK_20261207) quando a coluna ja existe com outra forma, sem mudar nada");

  // ----------------------------------------------------------- mutantes
  console.log("\n  --- MUTANTES (cada guarda retirada tem de deixar a prova VERMELHA) ---");
  // O FOR SHARE tambem segura quem faz UPDATE, entao sem o LOCK a corrida de UPDATE ainda e
  // recusada (verificado: o mutante daquele caso passava). O LOCK e' o que segura o INSERT.
  await mutante("sem LOCK da tabela (corrida com INSERT)", casoCorridaInsert, trocar(MIG, T.lock, ""));
  await mutante("sem lock_timeout", casoTimeout, trocar(MIG, T.lockTimeout, ""));
  await mutante("sem o FOR SHARE (envelope REPEATABLE READ)", casoRepeatableRead, trocar(MIG, T.forShare, ""));
  await mutante("sem (a) usage_count", casoUsage, semRaise(MIG, MSG.usage));
  await mutante("sem (b) forma do baseline", casoForma, semRaise(MIG, MSG.forma));
  await mutante("sem (c) RLS", casoRls, semRaise(MIG, MSG.rls));
  await mutante("sem (d) dependentes (visao)", casoVisao, semRaise(MIG, MSG.dep));
  await mutante("sem (d) dependentes (coluna gerada)", casoGerada, semRaise(MIG, MSG.dep));
  await mutante(
    "(d) volta a ignorar TODO pg_attrdef (coluna gerada)",
    casoGerada,
    trocar(MIG, T.exclusao, "     AND d.classid <> 'pg_attrdef'::regclass;"),
  );
  await mutante(
    "(d) nao ignora o default da PROPRIA coluna (zero)",
    casoZero,
    trocar(MIG, T.exclusao, "     ;"),
  );
  await mutante("sem (e) funcoes", casoFuncao, semRaise(MIG, MSG.fn));
  await mutante("sem (f) valores", casoValor, semRaise(MIG, MSG.val));
  await mutante(
    "(f) com COALESCE (NULL vira 0)",
    casoNulo,
    trocar(MIG, T.nullComo0, "WHERE COALESCE(used_count, 0) <> 0'"),
  );
  await mutante("sem o RETURN da coluna ja ausente", casoIdempotente, trocar(MIG, T.retorno, ""));
  await mutante("sem o pos-voo", casoPosvoo, semRaise(MIG, MSG.pos));
  await mutante("rollback sem a conferencia de forma", casoRollbackRecusa, semRaise(RB, MSG.rb));
  // a camada final: o DROP sem CASCADE
  {
    const semD = semRaise(MIG, MSG.dep);
    await casoGeradaRedeFinal(semD); // verde: sem (d), o DROP sem CASCADE ainda recusa
    ok("camada final: SEM o item (d), o DROP COLUMN sem CASCADE ainda recusa a coluna gerada (Postgres 2BP01) e NADA e gravado");
    await mutante(
      "sem (d) E com CASCADE (coluna gerada some junto)",
      casoGeradaRedeFinal,
      trocar(semD, T.drop, "ALTER TABLE public.coupons DROP COLUMN IF EXISTS used_count CASCADE;"),
    );
  }

  console.log(`\n[contador-duplicado-viva] ${resultados} provas ok`);
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
    await usar("template1", (a) =>
      a.query(`DROP ROLE IF EXISTS ${P.dono}`),
    ).catch(() => {});
  });

// `falhar` fica importado para o caso de a trava de efemero recusar antes.
void falhar;
void MOLDE;
