"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos montados de literais do repositorio, nunca de entrada de rede. */
// Executada apenas pelo rpc-ci, num clone descartavel; nao executar em loja.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");
const dir = path.join(__dirname, "../../supabase/migrations");
const nome = "20261310000000_estilo_do_card_de_frete.sql";
const ler = (n) => fs.readFileSync(path.join(dir, n), "utf8");
const consultas = path.join(__dirname, "../../scripts/publicacao/consultas");
async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  await c.query("BEGIN");
  try {
    const [a, b] = [
      "60a-conferir-estilo-card-frete-aplicado",
      "60b-antes-estilo-card-frete-base-vigente",
    ].map((n) => fs.readFileSync(path.join(consultas, `${n}.sql`), "utf8"));
    const prova = async (sql, ok) => {
      const r = await c.query(sql);
      assert.equal(r.rows.length, 5);
      assert.equal(
        r.rows.every((x) => x.ok === true),
        ok,
      );
    };
    await prova(a, true);
    await prova(b, false);
    const anterior = await c.query(
      "SELECT proacl::text AS acl FROM pg_proc WHERE oid = 'public.upsert_store_config(jsonb)'::regprocedure",
    );
    await c.query(ler(nome)); // reaplicacao idempotente
    await prova(a, true);
    // service_role e um chamador autorizado das configuracoes.
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    await c.query("SET LOCAL ROLE service_role");
    let r = await c.query(
      `SELECT public.upsert_store_config('{"free_shipping_card_style":"compacto"}'::jsonb) AS config`,
    );
    assert.equal(r.rows[0].config.free_shipping_card_style, "compacto");
    r = await c.query(
      `SELECT public.upsert_store_config('{"share_text":"Texto ficticio"}'::jsonb) AS config`,
    );
    assert.equal(r.rows[0].config.free_shipping_card_style, "compacto");
    await c.query("RESET ROLE");
    r = await c.query(
      "SELECT free_shipping_card_style FROM public.v_store_config",
    );
    assert.equal(r.rows[0].free_shipping_card_style, "compacto");
    await c.query("SAVEPOINT negativo");
    await assert.rejects(
      c.query(
        `SELECT public.upsert_store_config('{"free_shipping_card_style":"invalido"}'::jsonb)`,
      ),
      /check constraint/i,
    );
    await c.query("ROLLBACK TO SAVEPOINT negativo");
    await c.query("SET LOCAL ROLE anon");
    await c.query("SAVEPOINT anonimo");
    await assert.rejects(
      c.query("SELECT public.upsert_store_config('{}'::jsonb)"),
      /permission denied/i,
    );
    await c.query("ROLLBACK TO SAVEPOINT anonimo");
    await c.query("RESET ROLE");
    await c.query(ler(`rollback-manual-${nome}`));
    await prova(a, false);
    await prova(b, true);
    r = await c.query(
      "SELECT free_shipping_card_style FROM public.store_config",
    );
    assert.equal(
      r.rows[0].free_shipping_card_style,
      "compacto",
      "rollback nao apaga escolha",
    );
    const depois = await c.query(
      "SELECT proacl::text AS acl FROM pg_proc WHERE oid = 'public.upsert_store_config(jsonb)'::regprocedure",
    );
    assert.deepEqual(depois.rows, anterior.rows);
    await c.query("SAVEPOINT rollback_repetido");
    await assert.rejects(
      c.query(ler(`rollback-manual-${nome}`)),
      /B1_BASELINE_DIVERGENT/,
    );
    await c.query("ROLLBACK TO SAVEPOINT rollback_repetido");
    await c.query(ler(nome));
    await prova(a, true);
    console.log(
      "PASSOU estilo do card: persistencia, parcial, view, CHECK, ACL, idempotencia e rollback.",
    );
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
}
main().catch((e) => falhar("FALHOU", e.stack || e.message));
