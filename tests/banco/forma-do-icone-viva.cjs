"use strict";
// SOMENTE Postgres efêmero do CI (rodar-isolado.cjs); nunca banco de loja.
// Prova a forma (path SVG) do ícone da categoria: o que a CHECK aceita e recusa, o dado que já existia
// antes da migration, reaplicação, rollback (que apaga só a coluna nova), permissões herdadas e pré-voo.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const ROOT = path.resolve(__dirname, "../..");
const ARQ = "20261351000000_a_categoria_ganha_a_forma_do_icone.sql";
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const migration = ler(`supabase/migrations/${ARQ}`);
const rollback = ler(`supabase/migrations/rollback-manual-${ARQ}`);
const A = ler(
  "scripts/publicacao/consultas/63a-conferir-forma-do-icone-aplicado.sql",
);
const B = ler(
  "scripts/publicacao/consultas/63b-antes-forma-do-icone-ausente.sql",
);
// O catálogo que o painel serve: todo `d` dele tem de passar na CHECK do banco.
const CATALOGO = JSON.parse(
  ler("docs/design/icones-de-categoria/catalogo.json"),
);
const ID = "c3510000-0000-4000-8000-000000000001";
const ID_ANTIGA = "c3510000-0000-4000-8000-000000000002";
const C = new Client({ connectionString: lerDatabaseUrlEfemera() });

async function tentar(sql, params = []) {
  await C.query("SAVEPOINT tentativa");
  try {
    const r = await C.query(sql, params);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas: r.rows };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    return { codigo: e.code, erro: e.message };
  }
}
async function conferir(sql, passa) {
  const linhas = (await C.query(sql)).rows;
  assert.equal(linhas.length, 5);
  assert.equal(
    linhas.every((r) => r.ok === true),
    passa,
    JSON.stringify(linhas),
  );
}
async function retrato() {
  return (
    await C.query(`SELECT c.relacl::text, c.relrowsecurity,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p
      WHERE schemaname = 'public' AND tablename = 'categorias') AS policies
    FROM pg_class c WHERE c.oid = 'public.categorias'::regclass`)
  ).rows;
}
async function papel(nome, admin = false) {
  await C.query("RESET ROLE");
  await C.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({
      role: nome,
      app_metadata: { role: admin ? "admin" : "customer" },
    }),
  ]);
  // Só literais fechados deste teste, nunca identificador recebido de rede.
  if (nome === "anon") await C.query("SET LOCAL ROLE anon");
  else if (nome === "authenticated")
    await C.query("SET LOCAL ROLE authenticated");
}
const gravar = (forma) =>
  tentar(
    "UPDATE public.categorias SET icone_forma=$1 WHERE id=$2 RETURNING icone_forma",
    [forma, ID],
  );

async function main() {
  await C.connect();
  await C.query("BEGIN");
  try {
    await conferir(A, true);
    await conferir(B, false);
    const antes = await retrato();

    // Dado que já existia antes da migration: categoria com `icone` das 14 chaves e outra sem ícone nenhum.
    await C.query(
      "INSERT INTO public.categorias(id,nome,slug,icone) VALUES ($1,'Fixture forma','fixture-forma','casa'),($2,'Fixture antiga','fixture-antiga',NULL)",
      [ID, ID_ANTIGA],
    );

    // Base anterior (rollback): a coluna some, o ícone das 14 chaves e as linhas ficam, os róis trocam de lado.
    await C.query(rollback);
    await conferir(B, true);
    await conferir(A, false);
    assert.deepEqual(
      (
        await C.query(
          "SELECT id, icone FROM public.categorias WHERE id IN ($1,$2) ORDER BY id",
          [ID, ID_ANTIGA],
        )
      ).rows,
      [
        { id: ID, icone: "casa" },
        { id: ID_ANTIGA, icone: null },
      ],
      "rollback preserva as linhas e o icone das 14 chaves",
    );
    assert.equal(
      (
        await C.query(
          "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='categorias' AND column_name='icone_forma'",
        )
      ).rows[0].n,
      0,
    );
    assert.deepEqual(await retrato(), antes, "rollback não muda permissões");

    // Aplica (duas vezes: idempotente) sobre dado existente: nada é reescrito, tudo nasce NULL.
    await C.query(migration);
    await C.query(migration);
    await conferir(A, true);
    await conferir(B, false);
    assert.deepEqual(await retrato(), antes, "migration não muda permissões");
    assert.deepEqual(
      (
        await C.query(
          "SELECT id, icone, icone_forma FROM public.categorias WHERE id IN ($1,$2) ORDER BY id",
          [ID, ID_ANTIGA],
        )
      ).rows,
      [
        { id: ID, icone: "casa", icone_forma: null },
        { id: ID_ANTIGA, icone: null, icone_forma: null },
      ],
      "linhas antigas intactas e sem forma",
    );

    // Admin grava: todo path do catálogo, vários traços, o limite exato e NULL.
    await papel("authenticated", true);
    assert.ok(CATALOGO.length >= 90, "catálogo do painel presente");
    for (const item of CATALOGO) {
      const r = await gravar(item.d);
      assert.deepEqual(
        r.linhas,
        [{ icone_forma: item.d }],
        `catálogo: ${item.chave} (${r.erro ?? ""})`,
      );
    }
    for (const bom of [
      "M0 0",
      "m3 15 4-1 3-5 4 4 5 1q3 1 3 4v2H2v-3q0-2 1-2Z",
      "M9 3l3 4 3-4M12 7v14.5",
      "M1,1 L2,2",
      `M${"1".repeat(399)}`, // exatamente 400 caracteres: o limite
    ]) {
      assert.equal(bom.length <= 400, true);
      assert.deepEqual((await gravar(bom)).linhas, [{ icone_forma: bom }]);
    }
    assert.deepEqual((await gravar(null)).linhas, [{ icone_forma: null }]);

    // As duas colunas não dependem uma da outra.
    await C.query(
      "UPDATE public.categorias SET icone=NULL, icone_forma='M0 0h.01' WHERE id=$1",
      [ID],
    );
    await C.query(
      "UPDATE public.categorias SET icone='moda', icone_forma=NULL WHERE id=$1",
      [ID],
    );
    await C.query(
      "UPDATE public.categorias SET icone='moda', icone_forma='M0 0h.01' WHERE id=$1",
      [ID],
    );
    const chaveInvalida = await tentar(
      "UPDATE public.categorias SET icone='javascript:alert(1)' WHERE id=$1",
      [ID],
    );
    assert.equal(
      chaveInvalida.codigo,
      "23514",
      "CHECK das 14 chaves segue valendo",
    );

    // A CHECK recusa tudo que não é geometria de path.
    const maus = [
      "<script>alert(1)</script>",
      "M0 0<path",
      "M0 0>",
      'M0 0"',
      "M0 0'",
      "M0 0&amp",
      "M0 0;",
      "M0 0:",
      "M0 0(1)",
      "M0 0)",
      "M0 0#fff",
      "M0 0%",
      "M0 0+1",
      "M0 0e5",
      "M0 0\n",
      "M0 0\t",
      "M0 0é",
      "M0 0\\",
      "javascript:alert(1)",
      "url(#x)",
      "",
      " M0 0",
      "L0 0",
      "0 0",
      `M${"a".repeat(500)}`,
      `M${"1".repeat(400)}`, // 401 caracteres: um acima do limite
    ];
    for (const mau of maus) {
      const r = await gravar(mau);
      assert.equal(
        r.codigo,
        "23514",
        `deve recusar ${JSON.stringify(mau).slice(0, 40)}: ${r.erro ?? "aceitou"}`,
      );
    }
    assert.equal(`M${"1".repeat(399)}`.length, 400);
    assert.equal(`M${"1".repeat(400)}`.length, 401);
    // "M" sozinho passa: o banco valida o alfabeto, não a gramática do path (o cliente, com path
    // incompleto, desenha nada). O que o banco garante é que nada além de geometria é gravado.
    assert.deepEqual((await gravar("M")).linhas, [{ icone_forma: "M" }]);
    // INSERT também passa pela CHECK.
    const insercao = await tentar(
      "INSERT INTO public.categorias(nome,slug,icone_forma) VALUES ('X','x-forma-ruim','<svg onload=1>')",
    );
    assert.equal(insercao.codigo, "23514");
    await gravar(null);

    // Leitura pública; escrita só do admin (a coluna herda a política e o grant da tabela).
    for (const nome of ["anon", "authenticated"]) {
      await papel(nome);
      const r = await C.query(
        "SELECT icone_forma FROM public.categorias WHERE id=$1",
        [ID],
      );
      assert.equal(r.rows.length, 1, "leitura pública da forma");
      const alteracao = await tentar(
        "UPDATE public.categorias SET icone_forma='M0 0' WHERE id=$1 RETURNING id",
        [ID],
      );
      assert(
        alteracao.codigo === "42501" || alteracao.linhas?.length === 0,
        "não-admin não grava a forma",
      );
    }

    // Rollback com forma gravada: a coluna sai com as escolhas novas; o ícone das 14 chaves fica.
    await papel("authenticated", true);
    await gravar("M0 0h.01");
    await C.query("RESET ROLE");
    await C.query(rollback);
    assert.deepEqual(
      (await C.query("SELECT icone FROM public.categorias WHERE id=$1", [ID]))
        .rows,
      [{ icone: "moda" }],
    );
    await conferir(B, true);
    assert.deepEqual(await retrato(), antes, "rollback não muda permissões");
    await C.query(migration);
    await conferir(A, true);
    assert.deepEqual(
      (
        await C.query("SELECT icone_forma FROM public.categorias WHERE id=$1", [
          ID,
        ])
      ).rows,
      [{ icone_forma: null }],
      "reaplicar recria a coluna vazia",
    );

    // Pré-voo: CHECK afrouxada, coluna de outro tipo e base sem a 1300 são recusadas; os portões veem.
    await C.query(
      "ALTER TABLE public.categorias DROP CONSTRAINT categorias_icone_forma_check",
    );
    await C.query(
      "ALTER TABLE public.categorias ADD CONSTRAINT categorias_icone_forma_check CHECK (true)",
    );
    await conferir(A, false);
    assert.match((await tentar(migration)).erro ?? "", /B1_BASELINE_DIVERGENT/);
    assert.match((await tentar(rollback)).erro ?? "", /B1_BASELINE_DIVERGENT/);
    await C.query(
      "ALTER TABLE public.categorias DROP CONSTRAINT categorias_icone_forma_check",
    );
    await C.query("ALTER TABLE public.categorias DROP COLUMN icone_forma");
    await C.query(
      "ALTER TABLE public.categorias ADD COLUMN icone_forma varchar(10)",
    );
    assert.match((await tentar(migration)).erro ?? "", /icone_forma existente/);
    await C.query("ALTER TABLE public.categorias DROP COLUMN icone_forma");
    await conferir(B, true);

    await C.query(
      "ALTER TABLE public.categorias DROP CONSTRAINT categorias_icone_check",
    );
    await conferir(B, false);
    assert.match(
      (await tentar(migration)).erro ?? "",
      /categorias_icone_check/,
      "sem a 20261300000000 a migration recusa",
    );
    console.log(
      "[forma-do-icone] PASSOU: catálogo inteiro, limite 400, recusas, NULL, dado antigo, ACL/RLS, idempotência, rollback e pré-voo",
    );
  } finally {
    await C.query("ROLLBACK");
    await C.end();
  }
}
main().catch((e) => {
  console.error("[forma-do-icone] FALHOU:", e.message);
  process.exitCode = 1;
});
