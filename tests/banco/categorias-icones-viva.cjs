"use strict";
// SOMENTE Postgres efêmero do CI (rodar-isolado.cjs); nunca banco de loja.
// Prova permissões herdadas, as 14 chaves, pré-voo, reaplicação e rollback sem perda.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const ROOT = path.resolve(__dirname, "../..");
const ARQ = "20261300000000_as_categorias_ganham_icone.sql";
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const migration = ler(`supabase/migrations/${ARQ}`);
const rollback = ler(`supabase/migrations/rollback-manual-${ARQ}`);
const A = ler(
  "scripts/publicacao/consultas/61a-conferir-icones-das-categorias-aplicado.sql",
);
const B = ler(
  "scripts/publicacao/consultas/61b-antes-icones-das-categorias.sql",
);
const CHAVES = [
  "todas",
  "cuidado",
  "brinquedo",
  "calcados",
  "moda",
  "casa",
  "tecnologia",
  "beleza",
  "esporte",
  "pet",
  "alimento",
  "papelaria",
  "ferramentas",
  "joias",
];
const ID = "c3000000-0000-4000-8000-000000000001";
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
  assert.equal(linhas.length, 4);
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
async function main() {
  await C.connect();
  await C.query("BEGIN");
  try {
    await conferir(A, true);
    await conferir(B, false);
    const antes = await retrato();
    await C.query(
      "INSERT INTO public.categorias(id,nome,slug) VALUES ($1,'Fixture ícone','fixture-icone')",
      [ID],
    );

    // Bases e reaplicações: não reescrevem linhas nem abrem privilégios.
    await C.query(rollback);
    await conferir(B, true);
    await conferir(A, false);
    await C.query("ALTER TABLE public.categorias DROP COLUMN icone"); // só clone descartável
    await conferir(B, true);
    await C.query(migration);
    await C.query(migration);
    await conferir(A, true);
    assert.deepEqual(await retrato(), antes);

    await papel("authenticated", true);
    for (const chave of [...CHAVES, null]) {
      const r = await C.query(
        "UPDATE public.categorias SET icone=$1 WHERE id=$2 RETURNING icone",
        [chave, ID],
      );
      assert.deepEqual(r.rows, [{ icone: chave }]);
    }
    const invalido = await tentar(
      "UPDATE public.categorias SET icone='javascript:alert(1)' WHERE id=$1",
      [ID],
    );
    assert.equal(invalido.codigo, "23514", "CHECK recusa chave fora da lista");

    for (const nome of ["anon", "authenticated"]) {
      await papel(nome);
      const r = await C.query(
        "SELECT icone FROM public.categorias WHERE id=$1",
        [ID],
      );
      assert.equal(r.rows.length, 1, "leitura pública");
      const alteracao = await tentar(
        "UPDATE public.categorias SET icone='casa' WHERE id=$1 RETURNING id",
        [ID],
      );
      assert(
        alteracao.codigo === "42501" || alteracao.linhas?.length === 0,
        "não-admin não grava",
      );
    }

    await papel("authenticated", true);
    await C.query("UPDATE public.categorias SET icone='casa' WHERE id=$1", [
      ID,
    ]);
    await C.query("RESET ROLE");
    await C.query(rollback);
    assert.equal(
      (await C.query("SELECT icone FROM public.categorias WHERE id=$1", [ID]))
        .rows[0].icone,
      "casa",
    );
    assert.deepEqual(
      await retrato(),
      antes,
      "rollback também não muda permissões",
    );
    await conferir(B, true);
    await C.query(migration);
    await conferir(A, true);
    assert.equal(
      (await C.query("SELECT icone FROM public.categorias WHERE id=$1", [ID]))
        .rows[0].icone,
      "casa",
    );

    // Pré-voo recusa CHECK afrouxada; os portões também têm de vê-la.
    await C.query(
      "ALTER TABLE public.categorias DROP CONSTRAINT categorias_icone_check",
    );
    await C.query(
      "ALTER TABLE public.categorias ADD CONSTRAINT categorias_icone_check CHECK (true)",
    );
    await conferir(A, false);
    const recusada = await tentar(migration);
    assert.match(recusada.erro ?? "", /B1_BASELINE_DIVERGENT/);
    const reversao = await tentar(rollback);
    assert.match(reversao.erro ?? "", /B1_BASELINE_DIVERGENT/);
    console.log(
      "[categorias-icones] PASSOU: 14 chaves, NULL, ACL/RLS, bases, reaplicação, rollback e CHECK divergente",
    );
  } finally {
    await C.query("ROLLBACK");
    await C.end();
  }
}
main().catch((e) => {
  console.error("[categorias-icones] FALHOU:", e.message);
  process.exitCode = 1;
});
