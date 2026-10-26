"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
/**
 * PROVA VIVA da migration 20261391100000_ninguem_grava_evento_de_analise_pela_api.sql (public.analytics_events)
 * contra o Postgres EFEMERO com as migrations aplicadas do zero (rpc-ci). Nunca banco de loja.
 *
 * O que prova:
 *  (1) Conta logada (authenticated) nao grava mais evento — nem com o proprio user_id (42501, sem chegar a RLS);
 *      visitante (anon) continua sem gravar; o dono da tabela (o servidor) segue gravando; o admin segue LENDO.
 *  (2) Controle: com o estado anterior (rollback) a conta logada grava com o proprio user_id e e' barrada pela RLS
 *      com o de outra pessoa — a revogacao e' a guarda.
 *  (3) Nenhuma funcao do schema public grava em analytics_events (a premissa da revogacao, medida no catalogo).
 *  (4) Reaplicar 2x nao muda o ACL nem as politicas; rollback recria a politica da 20261112000000 exatamente e devolve
 *      o ACL byte a byte; o segundo rollback recusa; reaplicar volta. Nenhum evento existente muda.
 *  (5) Pre-voo recusa sem escrever: outra politica de INSERT na tabela, funcao que grava nela, politica alterada.
 *  (6) Consultas 99a/99b nos dois sentidos, com o rol fechado do conferir-banco.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/ninguem-grava-evento-de-analise-pela-api-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "../..");
const NOME = "20261391100000_ninguem_grava_evento_de_analise_pela_api.sql";
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio repositorio
const CONF = require(
  path.join(RAIZ, "scripts", "publicacao", "conferir-banco.cjs"),
);
const ROL = new Map(Object.entries(CONF.ROL_FECHADO_POR_CONSULTA));
const C99A = "99a-conferir-ninguem-grava-evento-de-analise-aplicado";
const C99B = "99b-antes-ninguem-grava-evento-de-analise-base-vigente";
// A politica que a 20261112000000 deixou, como o catalogo a devolve.
const POLITICA_112 = {
  polname: "analytics_events_insert_policy",
  polcmd: "a",
  polpermissive: true,
  papeis: "{authenticated}",
  qual: null,
  chk: "(( SELECT auth.uid() AS uid) = user_id)",
};

const U_A = "a1391100-0000-4000-8000-00000000000a";
const U_B = "a1391100-0000-4000-8000-00000000000b";
const U_ADMIN = "a1391100-0000-4000-8000-0000000000ad";

async function isolado(c, acao) {
  await c.query("SAVEPOINT caso391c");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso391c");
    await c.query("RELEASE SAVEPOINT caso391c");
  }
}
async function como(c, papel, uid, sql, params = []) {
  await c.query("SAVEPOINT como391c");
  try {
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [
      uid || "",
    ]);
    await c.query(`SET LOCAL ROLE ${papel}`);
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT como391c");
    return { ok: true, r };
  } catch (erro) {
    await c.query("ROLLBACK TO SAVEPOINT como391c");
    await c.query("RELEASE SAVEPOINT como391c");
    return { ok: false, erro };
  }
}
const gravar = (c, papel, uid, dono) =>
  como(
    c,
    papel,
    uid,
    "INSERT INTO public.analytics_events (event_type, user_id, metadata) VALUES ('teste391', $1, '{}'::jsonb)",
    [dono],
  );
async function estado(c) {
  const acl = (
    await c.query(
      "SELECT relacl::text AS acl FROM pg_class WHERE oid = 'public.analytics_events'::regclass",
    )
  ).rows[0].acl;
  const politicas = (
    await c.query(
      `SELECT polname, polcmd, polpermissive, polroles::regrole[]::text AS papeis, pg_get_expr(polqual, polrelid) AS qual,
              pg_get_expr(polwithcheck, polrelid) AS chk
         FROM pg_policy WHERE polrelid = 'public.analytics_events'::regclass ORDER BY polname`,
    )
  ).rows;
  return { acl, politicas };
}
async function eventos(c) {
  return (
    await c.query(
      "SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY id), '[]') AS l FROM public.analytics_events e",
    )
  ).rows[0].l;
}
async function recusa(c, sql, padrao) {
  await c.query("SAVEPOINT recusa391c");
  try {
    await assert.rejects(() => c.query(sql), padrao);
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT recusa391c");
    await c.query("RELEASE SAVEPOINT recusa391c");
  }
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    for (const [id, meta] of [
      [U_A, {}],
      [U_B, {}],
      [U_ADMIN, { role: "admin" }],
    ])
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@analise391.invalid', $2::jsonb)`,
        [id, JSON.stringify(meta)],
      );
    for (const [id, papel] of [
      [U_A, "customer"],
      [U_B, "customer"],
      [U_ADMIN, "admin"],
    ])
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Ficticio 391', $2)
         ON CONFLICT (id) DO UPDATE SET role = $2`,
        [id, papel],
      );
    // Um evento que ja existia (gravado pelo dono da tabela, o servidor).
    await c.query(
      "INSERT INTO public.analytics_events (event_type, user_id) VALUES ('ja_existia391', $1)",
      [U_A],
    );

    // ---- 0. O topo instalado pelo CI e' o desta migration. ----
    const topo = await estado(c);
    assert.ok(
      !topo.politicas.some((p) => p.polcmd === "a" || p.polcmd === "*"),
      "sobrou politica de INSERT/ALL",
    );
    assert.ok(
      topo.politicas.some(
        (p) => p.polname === "analytics_events_select_policy",
      ),
      "a leitura do admin sumiu",
    );
    assert.doesNotMatch(
      topo.acl,
      /authenticated=a/,
      "authenticated ainda tem INSERT",
    );
    console.log(
      "  PASSOU o topo instalado (sem INSERT para authenticated, sem politica de INSERT, leitura do admin no lugar)",
    );

    // ---- 1. Ninguem de aplicacao grava; o servidor grava; o admin le. ----
    const cenario = async () => ({
      proprio: await gravar(c, "authenticated", U_A, U_A),
      alheio: await gravar(c, "authenticated", U_A, U_B),
      visitante: await gravar(c, "anon", null, null),
      dono: (
        await c.query(
          "INSERT INTO public.analytics_events (event_type) VALUES ('servidor391') RETURNING id",
        )
      ).rowCount,
      adminLe: (
        await como(
          c,
          "authenticated",
          U_ADMIN,
          "SELECT count(*)::int AS n FROM public.analytics_events WHERE event_type = 'ja_existia391'",
        )
      ).r?.rows[0].n,
    });
    const novo = await isolado(c, cenario);
    assert.equal(
      novo.proprio.ok,
      false,
      "conta logada gravou evento com o proprio user_id",
    );
    assert.equal(novo.proprio.erro.code, "42501");
    assert.match(
      novo.proprio.erro.message,
      /permission denied for table analytics_events/,
    );
    assert.equal(novo.alheio.ok, false);
    assert.equal(novo.visitante.ok, false, "visitante gravou evento");
    assert.equal(
      novo.dono,
      1,
      "o dono da tabela (o servidor) deixou de gravar",
    );
    assert.equal(novo.adminLe, 1, "o admin deixou de ler os eventos");
    console.log(
      "  PASSOU conta logada e visitante nao gravam (42501); o servidor grava; o admin le",
    );

    // ---- 2. Controle: no estado anterior a conta logada gravava. ----
    const antigo = await isolado(c, async () => {
      await c.query(rollback);
      return cenario();
    });
    assert.equal(
      antigo.proprio.ok,
      true,
      "controle: no estado anterior a conta logada gravava com o proprio user_id",
    );
    assert.equal(
      antigo.alheio.ok,
      false,
      "controle: com o user_id de outra pessoa a RLS ja barrava",
    );
    assert.match(antigo.alheio.erro.message, /row-level security/);
    assert.equal(
      antigo.visitante.ok,
      false,
      "controle: o visitante ja nao gravava (20261112000000)",
    );
    console.log(
      "  PASSOU controle: no estado anterior a conta logada gravava (a revogacao e' a guarda)",
    );

    // ---- 3. Nenhuma funcao de public grava na tabela. ----
    const gravadoras = (
      await c.query(
        `SELECT p.oid::regprocedure::text AS f FROM pg_proc p
          WHERE p.pronamespace = 'public'::regnamespace
            AND p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+(public[.])?"?analytics_events'`,
      )
    ).rows;
    assert.deepEqual(
      gravadoras,
      [],
      "alguma funcao de public grava em analytics_events",
    );
    console.log("  PASSOU nenhuma funcao de public grava em analytics_events");

    // ---- 4. Reaplicar, rollback exato, segundo rollback recusa, reaplicar volta; eventos intactos. ----
    await isolado(c, async () => {
      const e0 = await eventos(c);
      await c.query(migration);
      await c.query(migration);
      assert.deepEqual(
        await estado(c),
        topo,
        "reaplicar 2x mudou ACL ou politicas",
      );
      await c.query(rollback);
      const volta = await estado(c);
      assert.deepEqual(
        volta.politicas.find((p) => p.polname === POLITICA_112.polname),
        POLITICA_112,
        "o rollback nao recriou a politica da 20261112000000 exatamente",
      );
      assert.equal(
        volta.acl,
        topo.acl.replace("authenticated=", "authenticated=a"),
        "o rollback nao devolveu o ACL de antes (so o INSERT do authenticated)",
      );
      await recusa(c, rollback, /B1_BASELINE_DIVERGENT/);
      await c.query(migration);
      assert.deepEqual(
        await estado(c),
        topo,
        "reaplicar depois do rollback nao voltou ao mesmo estado",
      );
      assert.deepEqual(
        await eventos(c),
        e0,
        "aplicar/desfazer mexeu em evento",
      );
    });
    console.log(
      "  PASSOU reaplicar 2x, rollback exato (politica e ACL), segundo rollback recusa, reaplicar volta, eventos intactos",
    );

    // ---- 5. Pre-voo recusa sem escrever (a partir do estado ANTERIOR, onde a migration ainda tem o que fazer). ----
    const sabotagens = [
      [
        "outra politica de INSERT na tabela",
        "CREATE POLICY prova391_outra ON public.analytics_events FOR INSERT TO authenticated WITH CHECK (true)",
      ],
      [
        "funcao de public que grava na tabela",
        "CREATE FUNCTION public.prova391_grava() RETURNS void LANGUAGE sql AS $$ INSERT INTO public.analytics_events (event_type) VALUES ('x') $$",
      ],
      [
        "politica de INSERT alterada",
        "ALTER POLICY analytics_events_insert_policy ON public.analytics_events WITH CHECK (true)",
      ],
    ];
    for (const [nome, sabotar] of sabotagens) {
      await isolado(c, async () => {
        await c.query(rollback);
        await c.query(sabotar);
        const antes = await estado(c);
        await recusa(c, migration, /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(
          await estado(c),
          antes,
          `pre-voo (${nome}) escreveu antes de recusar`,
        );
      });
    }
    console.log(
      `  PASSOU pre-voo recusa sem escrever (${sabotagens.length} sabotagens)`,
    );

    // ---- 6. Consultas 99a/99b nos dois sentidos, com o rol fechado. ----
    const consulta = async (nome) => {
      const rows = (
        await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))
      ).rows;
      assert.deepEqual(
        rows.map((r) => r.item).sort(),
        [...ROL.get(nome)].sort(),
        `${nome}: o rol nao e o do conferir-banco`,
      );
      return rows
        .filter((r) => r.ok !== true)
        .map((r) => r.item)
        .sort();
    };
    const daMigration = (nome) =>
      ROL.get(nome)
        .filter((i) => !/controle|RLS ligada/.test(i))
        .sort();
    assert.deepEqual(await consulta(C99A), []);
    assert.deepEqual(await consulta(C99B), daMigration(C99B));
    await isolado(c, async () => {
      await c.query(rollback);
      assert.deepEqual(await consulta(C99B), []);
      assert.deepEqual(await consulta(C99A), daMigration(C99A));
    });
    console.log("  PASSOU consultas 99a/99b nos dois sentidos, rol fechado");

    console.log(
      "\n[ninguem-grava-evento-de-analise-pela-api] todas as provas passaram.",
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
