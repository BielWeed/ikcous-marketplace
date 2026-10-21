"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
// F1 / 20261370: somente Postgres descartavel do rpc-ci, nunca banco de loja.
// A prova nao roda automaticamente fora do CI_BANCO_EFEMERO=1 + localhost.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const NOME = "20261370000000_o_caixa_abre_so_na_conta_da_loja.sql";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const antes = ler("scripts/publicacao/consultas/83b-antes-caixa-so-na-conta-da-loja-base-vigente.sql");
const depois = ler("scripts/publicacao/consultas/83a-conferir-caixa-so-na-conta-da-loja-aplicado.sql");
const ADMIN = "5e370000-0000-4000-8000-000000000001";
const CAIXA = "f1000000-0000-4000-8000-000000000001";
const PERSONALIZADA = "5e370000-0000-4000-8000-000000000002";
const LEGADA = "5e370000-0000-4000-8000-000000000003";

async function fotografar(c) {
  return (await c.query(`SELECT
    (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id), '[]') FROM public.fin_caixa_sessoes s) AS sessoes,
    (SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY id), '[]') FROM public.fin_lancamentos l) AS lancamentos`)).rows[0];
}
async function funcao(c) {
  const atributos = (await c.query(`SELECT to_jsonb(p) AS atributos FROM pg_proc p
    WHERE oid = 'public.fin_caixa_abrir(numeric,uuid)'::regprocedure`)).rows[0].atributos;
  return { ...atributos, prosrc: atributos.prosrc.replace(/\r/g, "") };
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso370");
  try { return await acao(); }
  finally { await c.query("ROLLBACK TO SAVEPOINT caso370"); await c.query("RELEASE SAVEPOINT caso370"); }
}
async function recusa(c, acao, codigo, mensagem) {
  await isolado(c, async () => {
    await assert.rejects(acao, (e) => e.code === codigo && mensagem.test(e.message));
  });
}
async function conferir(c, sql, positivo) {
  const linhas = (await c.query(sql)).rows;
  assert.equal(linhas.length, 4);
  assert.equal(linhas.every((l) => l.ok === true), positivo);
}
async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    const topo = await funcao(c);
    await conferir(c, depois, true);
    await conferir(c, antes, false);
    await c.query(rollback);
    const anterior = await funcao(c);
    assert.equal(anterior.prosrc,
      ler("supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql")
        .match(/CREATE OR REPLACE FUNCTION public\.fin_caixa_abrir\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/)[1]);
    await conferir(c, antes, true);
    await c.query(`INSERT INTO auth.users (id, email, raw_app_meta_data)
      VALUES ($1, 'admin-caixa-370@fixture.invalid', '{"role":"admin"}')`, [ADMIN]);
    await c.query(`INSERT INTO public.profiles (id, full_name, role)
      VALUES ($1, 'Admin Caixa Ficticio', 'admin') ON CONFLICT (id) DO UPDATE SET role = 'admin'`, [ADMIN]);
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
    await c.query(`INSERT INTO public.fin_contas (id, nome, tipo, saldo_inicial, saldo_inicial_em)
      VALUES ($1, 'Caixa personalizado ficticio', 'caixa', 0, public.fin__hoje()),
             ($2, 'Caixa legado ficticio', 'caixa', 0, public.fin__hoje())`, [PERSONALIZADA, LEGADA]);
    // CONTROLE: a funcao anterior aceita a conta que nao recebe vendas.
    await c.query("SELECT public.fin_caixa_abrir(30, $1)", [LEGADA]);
    const dados = await fotografar(c);
    await c.query(migration);
    assert.deepEqual(await fotografar(c), dados, "apply alterou caixa ja aberto ou lancamento");
    assert.deepEqual(await funcao(c), topo, "apply nao reproduziu o topo instalado pelo CI");
    await conferir(c, depois, true);
    await conferir(c, antes, false);
    // Um cliente antigo tambem precisa ser barrado pelo servidor.
    for (const id of [PERSONALIZADA, LEGADA, "f1000000-0000-4000-8000-000000000002", "5e370000-0000-4000-8000-000000000099"]) {
      await recusa(c, () => c.query("SELECT public.fin_caixa_abrir(30, $1)", [id]), "22023",
        /Abra o caixa na conta Caixa da loja/);
      assert.deepEqual(await fotografar(c), dados, "recusa gravou dado");
    }
    // Conta omitida, NULL e UUID explicito continuam na conta de sistema.
    for (const sql of ["SELECT public.fin_caixa_abrir(0) AS r",
      "SELECT public.fin_caixa_abrir(0, NULL) AS r",
      `SELECT public.fin_caixa_abrir(0, '${CAIXA}') AS r`]) {
      await isolado(c, async () => {
        const id = (await c.query(sql)).rows[0].r.id;
        assert.equal((await c.query("SELECT conta_id FROM public.fin_caixa_sessoes WHERE id = $1", [id])).rows[0].conta_id, CAIXA);
      });
    }
    await c.query(migration);
    await c.query(migration.replace(/\n/g, "\r\n"));
    assert.deepEqual(await fotografar(c), dados, "reaplicar tocou dados");
    assert.deepEqual(await funcao(c), topo, "reaplicar mudou OID, dono, ACL ou atributos");
    // Corpo ou atributos desconhecidos: preflight deve recusar sem escrita.
    for (const sabotagem of [
      (await c.query("SELECT pg_get_functiondef('public.fin_caixa_abrir(numeric,uuid)'::regprocedure) AS d")).rows[0].d
        .replace("DECLARE", "-- corpo desconhecido\nDECLARE"),
      "ALTER FUNCTION public.fin_caixa_abrir(numeric,uuid) SECURITY INVOKER",
      "ALTER FUNCTION public.fin_caixa_abrir(numeric,uuid) SET search_path TO pg_catalog",
      "GRANT EXECUTE ON FUNCTION public.fin_caixa_abrir(numeric,uuid) TO anon",
    ]) {
      await isolado(c, async () => {
        await c.query(sabotagem);
        const sabotada = await funcao(c);
        await recusa(c, () => c.query(migration), "P0001", /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(await funcao(c), sabotada, "preflight escreveu antes de recusar");
        assert.deepEqual(await fotografar(c), dados);
      });
    }
    await c.query(rollback);
    assert.deepEqual(await funcao(c), anterior, "rollback nao devolveu corpo/atributos byte a byte");
    assert.deepEqual(await fotografar(c), dados, "rollback tocou dados");
    await recusa(c, () => c.query(rollback), "P0001", /B1_BASELINE_DIVERGENT/);
    await isolado(c, async () => {
      await c.query("SELECT public.fin_caixa_abrir(30, $1)", [PERSONALIZADA]);
    });
    await c.query(migration);
    // CONTROLE NEGATIVO causal: sem a guarda, a chamada rejeitada acima passa.
    await isolado(c, async () => {
      const definicao = (await c.query("SELECT pg_get_functiondef('public.fin_caixa_abrir(numeric,uuid)'::regprocedure) AS d")).rows[0].d;
      const mutante = definicao.replace(/  IF p_conta_id IS NOT NULL[\s\S]*?  END IF;\n/, "");
      assert.notEqual(mutante, definicao, "mutante nao tirou a guarda");
      await c.query(mutante);
      const id = (await c.query("SELECT public.fin_caixa_abrir(30, $1) AS r", [PERSONALIZADA])).rows[0].r.id;
      assert.ok(id, "controle sem guarda nao abriu a conta personalizada");
    });
    console.log("PASSOU 370: personalizada recusa sem escrita; legado aberto preservado; padrao/NULL/UUID; reaplicacao/CRLF; rollback exato; preflight; consultas 83a/83b; controle sem guarda.");
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
