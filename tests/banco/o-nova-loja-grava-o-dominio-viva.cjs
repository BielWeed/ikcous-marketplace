"use strict";

/**
 * PROVA VIVA da escrita do passo `dominio` do nova-loja (sqlDoDominio, exportado de scripts/frota/nova-loja.mjs) contra o
 * Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci), em banco CLONADO (rodar-isolado).
 *
 * O DEFEITO: numa loja nova nada gravava public.store_config.dominio_publico (a migration 20261540000000 cria a ficha
 * id = 1 com o domínio NULL). Sem ele o porteiro responde 503 (decidirConcordancia → sem-loja) e o
 * identidade-bootstrap --alvo-novo recusa por ESTADO. O passo `dominio` grava `<slug>.vercel.app` com UM UPDATE guardado
 * (`AND dominio_publico IS NULL`) pela database/query da Management API, sem SET ROLE.
 *
 * A TRAVA QUE ELE PRECISA ATRAVESSAR: dominio_publico_so_muda_pela_frota (20261140000000, WHEN ampliado na 20261150000000)
 * só deixa mudar o domínio a quem tem claim `role = service_role` OU não tem papel no JWT E está com o GUC `role` fora de
 * anon/authenticated. A sessão da "API" aqui é a do pg-meta: conexão nova, sem request.jwt.claims, sem SET ROLE (GUC role
 * 'none'), o texto inteiro numa consulta simples (sem parâmetros).
 *
 * O QUE SE PROVA:
 *   (0) o banco montado pela fila tem a ficha id = 1 com o domínio NULL e a vitrine anônima (v_store_config) lê NULL:
 *       é o defeito; e a sessão da "API" é a que a trava deixa passar (GUC role 'none', sem claims);
 *   (1) como authenticated com claims de uma admin REAL (nas duas fontes do cargo), o MESMO texto é recusado com 42501
 *       DOMINIO_PUBLICO_SO_MUDA_PELA_FROTA, e nada muda; CONTROLE: a mesma sessão alcança a linha (um UPDATE de
 *       share_text pega 1 linha), então a recusa é a trava, não a RLS;
 *   (2) pela sessão da "API": 1 linha, a ficha passa a declarar o domínio, e a leitura ANÔNIMA (e a autenticada) de
 *       v_store_config devolve o domínio (é o que o porteiro e o identidade-bootstrap leem);
 *   (3) repetir: 0 linha, a ficha byte a byte igual (idempotente);
 *   (4) a ficha com OUTRO domínio (uma loja que já tinha, ou alguém que gravou entre a leitura e o UPDATE): 0 linha e
 *       o outro domínio fica; CONTROLE (mutante): o mesmo UPDATE SEM a guarda sobrescreve (desfeito no ROLLBACK).
 *
 * LIMITE DECLARADO: no postgres:17 do CI a sessão é o papel postgres SUPERUSUÁRIO; no Supabase o postgres não é. A trava
 * só lê o claim do JWT e o GUC role (nenhum dos dois depende de superusuário), e o postgres é dono de store_config nos
 * dois. Esta prova NÃO prova o que o pg-meta da Management API de uma loja real põe no GUC role ou em
 * request.jwt.claims: se ali a trava recusar, o passo dá NÃO com a orientação (tests/frota_nova_loja_comando_test.ts).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-nova-loja-grava-o-dominio-viva.cjs
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "..", "..");
const SCRIPT = path.join(RAIZ, "scripts", "frota", "nova-loja.mjs");

const SLUG = "loja-prova-dominio";
const ESPERADO = `${SLUG}.vercel.app`;
const OUTRO = "outra-loja.vercel.app";
const U_ADMIN = "d1565000-0000-4000-8000-000000000001";
const CLAIMS_ADMIN = JSON.stringify({
  sub: U_ADMIN,
  role: "authenticated",
  app_metadata: { role: "admin" },
});

let URL_EFEMERA = "";
let SQL = "";

/**
 * A "Management API": conexão nova, sem claims nem SET ROLE, o texto inteiro numa consulta simples. Devolve rowCount
 * e as linhas do último comando, ou o SQLSTATE do erro. Nunca lança por erro de SQL.
 */
async function pelaApi(sql) {
  const k = new Client({
    connectionString: URL_EFEMERA,
    application_name: "prova_dominio_api",
  });
  await k.connect();
  try {
    try {
      const r = await k.query(sql);
      const ultimo = Array.isArray(r) ? r[r.length - 1] : r;
      return { ok: true, rowCount: ultimo.rowCount, rows: ultimo.rows };
    } catch (e) {
      return { ok: false, code: e.code, message: e.message };
    }
  } finally {
    await k.end().catch(() => {});
  }
}

/** A ficha id = 1 inteira (como o dono), para "nada mudou". */
async function ficha(c) {
  const r = await c.query(
    "SELECT dominio_publico AS d, md5(to_jsonb(s)::text) AS h FROM public.store_config s WHERE id = 1",
  );
  assert.equal(r.rows.length, 1, "a ficha id = 1 tem de existir");
  return r.rows[0];
}

/** Roda `fn` num SAVEPOINT sempre desfeito; devolve o erro (ou null). */
let contaSp = 0;
async function tentar(c, fn) {
  const sp = `sp_dominio_${++contaSp}`;
  await c.query(`SAVEPOINT ${sp}`);
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await c.query(`RELEASE SAVEPOINT ${sp}`);
  }
}

/** O que o porteiro e o identidade-bootstrap leem: v_store_config.dominio_publico de id = 1, como anon e authenticated. */
async function leituraPublica(c) {
  const sql = "SELECT dominio_publico FROM public.v_store_config WHERE id = 1";
  const ler = async (papel, claims) => {
    let rows = null;
    await c.query("BEGIN");
    try {
      await c.query(`SET LOCAL ROLE ${papel}`);
      await c.query(
        "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
        [papel === "anon" ? "" : U_ADMIN, claims],
      );
      rows = (await c.query(sql)).rows;
    } finally {
      await c.query("ROLLBACK");
    }
    assert.equal(rows.length, 1, `${papel}: v_store_config devolve 1 linha`);
    return rows[0].dominio_publico;
  };
  return {
    anon: await ler("anon", JSON.stringify({ role: "anon" })),
    authenticated: await ler("authenticated", CLAIMS_ADMIN),
  };
}

const PROVAS = [];

PROVAS.push({
  nome: "(0) banco montado pela fila: ficha id = 1 com o domínio NULL e a vitrine anônima lê NULL (o defeito); a sessão da API tem GUC role 'none' e nenhum claim",
  corpo: async (c) => {
    const f = await ficha(c);
    assert.equal(
      f.d,
      null,
      "a fila de migrations não grava o domínio (é o que o passo dominio conserta)",
    );
    // a admin REAL para o (1): nas duas fontes do cargo (as travas de cargo leem o GUC role: SET LOCAL ROLE postgres)
    await c.query(
      "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
    );
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL ROLE postgres");
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data)
         VALUES ($1::uuid, $1::text || '@dominio.invalid', '{"role":"admin"}'::jsonb)`,
        [U_ADMIN],
      );
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin da prova do dominio', 'admin')
         ON CONFLICT (id) DO UPDATE SET role = 'admin'`,
        [U_ADMIN],
      );
      await c.query(
        `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb WHERE id = $1::uuid`,
        [U_ADMIN],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
    const papeis = (
      await c.query(
        `SELECT u.raw_app_meta_data ->> 'role' AS a, p.role AS p
           FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE u.id = $1::uuid`,
        [U_ADMIN],
      )
    ).rows;
    assert.deepEqual(papeis, [{ a: "admin", p: "admin" }], "a admin da prova");
    assert.deepEqual(await leituraPublica(c), {
      anon: null,
      authenticated: null,
    });
    const quem = await pelaApi(
      "SELECT current_setting('role') AS r, current_setting('request.jwt.claims', true) AS j;",
    );
    assert.ok(quem.ok, quem.message);
    assert.equal(quem.rows[0].r, "none", "o GUC role da sessão da API");
    assert.ok(
      quem.rows[0].j === null || quem.rows[0].j === "",
      `a sessão da API não pode ter claims: ${quem.rows[0].j}`,
    );
  },
});

PROVAS.push({
  nome: "(1) como authenticated (admin real nas duas fontes) o MESMO texto é recusado: 42501 DOMINIO_PUBLICO_SO_MUDA_PELA_FROTA, nada muda; CONTROLE: a mesma sessão alcança a linha (share_text pega 1 linha)",
  corpo: async (c) => {
    const antes = await ficha(c);
    let controle = null;
    let erro = null;
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL ROLE authenticated");
      await c.query(
        "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
        [U_ADMIN, CLAIMS_ADMIN],
      );
      const e1 = await tentar(c, async () => {
        controle = (
          await c.query(
            "UPDATE public.store_config SET share_text = share_text WHERE id = 1",
          )
        ).rowCount;
      });
      assert.equal(e1, null, `o controle (share_text) falhou: ${e1?.message}`);
      erro = await tentar(c, () => c.query(SQL));
    } finally {
      await c.query("ROLLBACK");
    }
    assert.equal(
      controle,
      1,
      "a admin autenticada tem de alcançar a linha (senão a recusa seria a RLS, não a trava)",
    );
    assert.ok(erro, "authenticated gravou o domínio: a trava não recusou");
    assert.equal(erro.code, "42501", erro.message);
    assert.match(erro.message, /DOMINIO_PUBLICO_SO_MUDA_PELA_FROTA/);
    assert.deepEqual(await ficha(c), antes);
  },
});

PROVAS.push({
  nome: "(2) pela sessão da API (sem JWT, sem SET ROLE): 1 linha, a ficha declara o domínio e a leitura anônima de v_store_config o devolve",
  corpo: async (c) => {
    const r = await pelaApi(SQL);
    assert.ok(r.ok, `a sessão da API foi recusada: ${r.code} ${r.message}`);
    assert.equal(r.rowCount, 1);
    assert.equal((await ficha(c)).d, ESPERADO);
    assert.deepEqual(await leituraPublica(c), {
      anon: ESPERADO,
      authenticated: ESPERADO,
    });
  },
});

PROVAS.push({
  nome: "(3) repetir: 0 linha e a ficha byte a byte igual",
  corpo: async (c) => {
    const antes = await ficha(c);
    assert.equal(antes.d, ESPERADO, "a (2) deixa o domínio gravado");
    const r = await pelaApi(SQL);
    assert.ok(r.ok, `${r.code} ${r.message}`);
    assert.equal(r.rowCount, 0);
    assert.deepEqual(await ficha(c), antes);
  },
});

PROVAS.push({
  nome: "(4) a ficha com OUTRO domínio: 0 linha e o outro fica; CONTROLE: o UPDATE sem a guarda sobrescreve (desfeito)",
  corpo: async (c) => {
    // o outro domínio, gravado como a frota grava (sessão sem JWT nem SET ROLE)
    const o = await pelaApi(
      `UPDATE public.store_config SET dominio_publico = '${OUTRO}' WHERE id = 1;`,
    );
    assert.ok(o.ok, `${o.code} ${o.message}`);
    const antes = await ficha(c);
    assert.equal(antes.d, OUTRO);
    const r = await pelaApi(SQL);
    assert.ok(r.ok, `${r.code} ${r.message}`);
    assert.equal(r.rowCount, 0, "a guarda tinha de impedir a sobrescrita");
    assert.deepEqual(await ficha(c), antes);
    // o mutante: sem `AND dominio_publico IS NULL`
    const semGuarda = SQL.replace(" AND dominio_publico IS NULL", "");
    assert.notEqual(
      semGuarda,
      SQL,
      "o texto do script mudou: ajuste o mutante",
    );
    await c.query("BEGIN");
    try {
      const m = await c.query(semGuarda);
      assert.equal(m.rowCount, 1);
      assert.equal(
        (
          await c.query(
            "SELECT dominio_publico AS d FROM public.store_config WHERE id = 1",
          )
        ).rows[0].d,
        ESPERADO,
        "sem a guarda o UPDATE sobrescreve o outro domínio",
      );
    } finally {
      await c.query("ROLLBACK");
    }
    assert.deepEqual(await ficha(c), antes);
  },
});

async function main() {
  URL_EFEMERA = lerDatabaseUrlEfemera();
  const { sqlDoDominio } = await import(pathToFileURL(SCRIPT).href);
  assert.equal(typeof sqlDoDominio, "function", "sqlDoDominio não é exportado");
  SQL = sqlDoDominio(SLUG);
  assert.equal(
    SQL,
    `UPDATE public.store_config SET dominio_publico = '${ESPERADO}' WHERE id = 1 AND dominio_publico IS NULL;`,
  );
  const cliente = new Client({ connectionString: URL_EFEMERA });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  const titulo =
    "Prova viva: o nova-loja grava o domínio da loja nova (rpc-ci)";
  let falhou = false;
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        falhou = true;
        break;
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  if (falhou) {
    anexarAoSummary(titulo, linhas.join("\n"));
    falhar(
      "FALHOU",
      "Uma regra do passo dominio foi quebrada — ver acima qual.",
    );
  }
  console.log(`\n[dominio] ${PROVAS.length}/${PROVAS.length} provas passaram.`);
  anexarAoSummary(
    titulo,
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main().catch((erro) => falhar("INDETERMINADO", erro.message));
