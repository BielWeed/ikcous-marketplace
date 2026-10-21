"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos literais do repositorio. */
// Apenas no clone descartavel do rpc-ci. Nao executar em banco de loja.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");
const raiz = path.join(__dirname, "../..");
const ler = (p) => fs.readFileSync(path.join(raiz, p), "utf8");
const migracao = "supabase/migrations/20261330000000_mototaxi_privado.sql";
const rollback =
  "supabase/migrations/rollback-manual-20261330000000_mototaxi_privado.sql";
const admin = "33000000-0000-4000-8000-000000000001";
const comum = "33000000-0000-4000-8000-000000000002";
const claims = (id, role) =>
  JSON.stringify({ sub: id, role: "authenticated", app_metadata: { role } });

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  await c.query("BEGIN");
  try {
    const a = ler(
      "scripts/publicacao/consultas/62a-conferir-mototaxi-aplicado.sql",
    );
    const b = ler(
      "scripts/publicacao/consultas/62b-antes-mototaxi-ausente.sql",
    );
    const prova = async (sql, n, ok) => {
      const r = await c.query(sql);
      assert.equal(r.rows.length, n);
      assert.equal(
        r.rows.every((x) => x.ok === true),
        ok,
        JSON.stringify(r.rows),
      );
    };
    // Remocao somente no banco descartavel, antes de semear qualquer contato.
    // Reproduz a ausencia, o apply e a presenca em vez de presumir o apply do CI.
    await c.query(
      "DROP FUNCTION public.salvar_config_mototaxi(text,text); DROP TABLE public.config_mototaxi;",
    );
    await prova(b, 3, true);
    console.log("62b antes: 3/3 t");
    await c.query(ler(migracao));
    console.log("migration: aplicada no Postgres descartavel");
    await prova(a, 6, true);
    console.log("62a depois: 6/6 t");
    await prova(b, 3, false);
    const anterior = await c.query(
      "SELECT pg_get_viewdef('public.v_store_config'::regclass) AS v, pg_get_functiondef('public.upsert_store_config(jsonb)'::regprocedure) AS f",
    );
    for (const [id, role] of [
      [admin, "admin"],
      [comum, "customer"],
    ]) {
      await c.query(
        "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, $3::jsonb)",
        [id, `${id}@mototaxi.teste`, JSON.stringify({ role })],
      );
      await c.query(
        "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Fixture Mototaxi', $2)",
        [id, role],
      );
    }
    await c.query(
      'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\'::jsonb WHERE id = $1',
      [admin],
    );
    const entrar = async (id, role) => {
      await c.query("RESET ROLE");
      await c.query("SELECT set_config('request.jwt.claims',$1,true)", [
        claims(id, role),
      ]);
      await c.query("SELECT set_config('app.rpc.user_id',$1,true)", [id]);
      await c.query("SET LOCAL ROLE authenticated");
    };
    const recusado = async (
      sql,
      args = [],
      re = /permission denied|Nao autorizado/i,
    ) => {
      await c.query("SAVEPOINT negativo");
      await assert.rejects(c.query(sql, args), re);
      await c.query("ROLLBACK TO SAVEPOINT negativo");
    };
    await entrar(admin, "admin");
    const gravado = await c.query(
      "SELECT public.salvar_config_mototaxi($1,$2) AS c",
      ["5511987654321", "Zé"],
    );
    assert.deepEqual(gravado.rows[0].c, {
      whatsapp: "5511987654321",
      nome: "Zé",
    });
    assert.equal(
      (await c.query("SELECT * FROM public.config_mototaxi")).rows.length,
      1,
    );
    console.log("admin: leitura 1 linha; cadastro confirmado pela RPC");
    await recusado("UPDATE public.config_mototaxi SET nome = 'fora da RPC'");
    await recusado(
      "SELECT public.salvar_config_mototaxi('351912345678','X')",
      [],
      /check constraint/i,
    );
    await recusado(
      "SELECT public.salvar_config_mototaxi('551198765432199','X')",
      [],
      /check constraint/i,
    );
    await recusado(
      "SELECT public.salvar_config_mototaxi('11987654321','X')",
      [],
      /check constraint/i,
    );

    await entrar(comum, "customer");
    assert.equal(
      (await c.query("SELECT * FROM public.config_mototaxi")).rows.length,
      0,
    );
    console.log("cliente: leitura 0 linhas");
    await recusado("SELECT public.salvar_config_mototaxi('5511987654321','X')");
    await c.query("RESET ROLE");
    await c.query("SET LOCAL ROLE anon");
    await recusado("SELECT * FROM public.config_mototaxi");
    await recusado("SELECT public.salvar_config_mototaxi(NULL,NULL)");
    await c.query("RESET ROLE");

    // JWT antigo nao vence rebaixamento no banco.
    await c.query(
      "UPDATE auth.users SET raw_app_meta_data = '{}'::jsonb WHERE id = $1",
      [admin],
    );
    await entrar(admin, "admin");
    assert.equal(
      (await c.query("SELECT * FROM public.config_mototaxi")).rows.length,
      0,
    );
    await recusado("SELECT public.salvar_config_mototaxi(NULL,NULL)");
    console.log(
      "admin rebaixado com JWT antigo: leitura 0 linhas; RPC Nao autorizado",
    );
    await c.query("RESET ROLE");

    // Controle negativo da prova: uma policy publica a mais invalida 62a.
    await c.query("SAVEPOINT mutante");
    await c.query(
      "CREATE POLICY vazamento ON public.config_mototaxi FOR SELECT TO authenticated USING (true)",
    );
    await prova(a, 6, false);
    await c.query("ROLLBACK TO SAVEPOINT mutante");
    await prova(a, 6, true);

    await c.query(ler(rollback));
    await prova(a, 6, false);
    await prova(b, 3, false); // preservar contato nao equivale a ausencia
    assert.deepEqual(
      (await c.query("SELECT whatsapp,nome FROM public.config_mototaxi")).rows,
      [{ whatsapp: "5511987654321", nome: "Zé" }],
    );
    const depois = await c.query(
      "SELECT pg_get_viewdef('public.v_store_config'::regclass) AS v, pg_get_functiondef('public.upsert_store_config(jsonb)'::regprocedure) AS f",
    );
    assert.deepEqual(depois.rows, anterior.rows);
    // O rollback apaga a funcao e a politica (que usam as portas da 97) e PRESERVA a tabela e o contato.
    const objetos = await c.query(`SELECT
      to_regprocedure('public.salvar_config_mototaxi(text,text)') IS NULL AS sem_funcao,
      (SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'salvar_config_mototaxi') AS funcoes,
      (SELECT count(*)::int FROM pg_policy WHERE polrelid = to_regclass('public.config_mototaxi')) AS politicas,
      (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.config_mototaxi')) AS rls_ligada,
      has_table_privilege('service_role', 'public.config_mototaxi', 'SELECT') AS service_le,
      has_table_privilege('authenticated', 'public.config_mototaxi', 'SELECT') AS auth_le,
      has_table_privilege('anon', 'public.config_mototaxi', 'SELECT') AS anon_le`);
    assert.deepEqual(objetos.rows[0], {
      sem_funcao: true,
      funcoes: 0,
      politicas: 0,
      rls_ligada: true,
      service_le: true,
      auth_le: false,
      anon_le: false,
    });
    await entrar(comum, "customer");
    await recusado(
      "SELECT * FROM public.config_mototaxi",
      [],
      /permission denied/i,
    );
    await recusado(
      "SELECT public.salvar_config_mototaxi('5511987654321','X')",
      [],
      /does not exist/i,
    );
    await c.query("RESET ROLE");
    await c.query("SET LOCAL ROLE anon");
    await recusado(
      "SELECT * FROM public.config_mototaxi",
      [],
      /permission denied/i,
    );
    await c.query("RESET ROLE");
    // Segundo rollback recusa sem escrever (a funcao ja nao existe).
    await c.query("SAVEPOINT rollback_repetido");
    await assert.rejects(c.query(ler(rollback)), /B1_BASELINE_DIVERGENT/);
    await c.query("ROLLBACK TO SAVEPOINT rollback_repetido");
    console.log(
      "rollback: funcao e politica apagadas, contato e tabela preservados, acesso negado, view/upsert intactos",
    );
    await c.query("SAVEPOINT reaplicar");
    await assert.rejects(c.query(ler(migracao)), /B1_BASELINE_DIVERGENT/);
    await c.query("ROLLBACK TO SAVEPOINT reaplicar");
    console.log(
      "PASSOU mototaxi: admin atual, anon, cliente, CHECK BR, RLS/ACL, rollback preserva contato e configuracao publica intacta.",
    );
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
}
main().catch((e) => falhar("FALHOU", e.stack || e.message));
