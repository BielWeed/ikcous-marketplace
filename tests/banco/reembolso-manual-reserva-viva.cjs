"use strict";
// SOMENTE clone descartavel do CI. Nenhum banco de loja, nenhuma chamada ao MP.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const ROOT = path.resolve(__dirname, "../..");
const ARQ = "20261343000000_o_reembolso_manual_respeita_a_reserva.sql";
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const migration = ler(`supabase/migrations/${ARQ}`);
const rollback = ler(`supabase/migrations/rollback-manual-${ARQ}`);
const SIG = "public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)";
const C = new Client({ connectionString: lerDatabaseUrlEfemera() });
const ADMIN = "de343000-0000-4000-8000-000000000001";
const CLIENTE = "de343000-0000-4000-8000-000000000002";
let seq = 0;
const id = () => `de343000-0001-4000-8000-${String(++seq).padStart(12, "0")}`;
async function catalogo() {
  return (await C.query(`SELECT md5(replace(prosrc, chr(13), '')) AS hash,
    proacl::text, prosecdef, proconfig FROM pg_proc WHERE oid = to_regprocedure($1)`, [SIG])).rows[0];
}
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
async function conferir(nome, passa) {
  const linhas = (await C.query(ler(`scripts/publicacao/consultas/${nome}.sql`))).rows;
  assert.equal(linhas.length, 4);
  assert.equal(linhas.every((l) => l.ok), passa, JSON.stringify(linhas));
}
async function caso(dias, reserva, valor = null) {
  const pedido = id(), dev = id();
  await C.query(`INSERT INTO public.marketplace_orders
    (id,user_id,customer_name,customer_data,total,subtotal,shipping,status,canal,
     payment_method,payment_status,paid_at,pagamento_recebido_em,gateway_payment_id,valor_estornado)
    VALUES ($1,$2,'Fixture reserva','{}',100,100,0,'delivered','online','online','pago',
      now() - $3 * interval '1 day',now() - $3 * interval '1 day',$4,0)`,
    [pedido, CLIENTE, dias, `ORD343-${seq}`]);
  await C.query(`INSERT INTO public.devolucoes
    (id,protocolo,order_id,user_id,tipo,motivo,resolucao_desejada,modalidade,metodo_retorno,
     status,valor_itens,valor_frete_ida,prazo_ate,politica)
    VALUES ($1,$2,$3,$4,'arrependimento','fixture','reembolso','nacional','envio_proprio',
     'recebida',100,0,current_date+7,'{}')`, [dev,`DEV343-${seq}`,pedido,CLIENTE]);
  if (reserva) await C.query(`INSERT INTO public.order_refunds
    (order_id,amount,solicitado_por,status,mp_chargeback_id)
    VALUES ($1,100,'sistema','em_processamento',$2)`, [pedido,`CBK343-${seq}`]);
  await C.query("SELECT set_config('app.rpc.user_id',$1,true), set_config('request.jwt.claims',$2,true)",
    [ADMIN, JSON.stringify({role:"authenticated",app_metadata:{role:"admin"}})]);
  await C.query("SET LOCAL ROLE authenticated");
  const r = await tentar("SELECT public.admin_devolucao_concluir($1,'reembolso','[]',$2,NULL) AS r", [dev,valor]);
  await C.query("RESET ROLE");
  return { ...r, dev, pedido };
}
async function main() {
  await C.connect();
  await C.query("BEGIN");
  try {
    await C.query(`INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
      ($1,'admin343@fixture.test','{"role":"admin"}'),($2,'cliente343@fixture.test','{}')`, [ADMIN,CLIENTE]);
    await C.query(`INSERT INTO public.profiles(id,full_name,role) VALUES
      ($1,'Admin fixture','admin'),($2,'Cliente fixture','customer')`, [ADMIN,CLIENTE]);
    const antes = await catalogo();
    assert.equal(antes.hash, "ea651d52157521c0fe7ffccc948b4b1a");
    await conferir("67a-conferir-reembolso-manual-reserva-aplicado", true);
    await conferir("67b-antes-reembolso-manual-reserva", false);
    await C.query(rollback);
    assert.equal((await catalogo()).hash, "ebb901efff59a53082836a13e053cd1a");
    await conferir("67b-antes-reembolso-manual-reserva", true);
    // CONTROLE: a mesma reserva de R$100 permitia R$100 por fora no dia 181.
    const legado = await caso(181, true);
    assert.equal(legado.linhas?.[0].r.reembolso_manual, true);
    await C.query(migration);
    await C.query(migration);
    assert.deepEqual(await catalogo(), antes, "ACL/atributos/corpo preservados");
    for (const dias of [179,180,181]) {
      for (const valor of [null,100]) {
        const r = await caso(dias, true, valor);
        assert.equal(r.codigo, "22023");
        assert.match(r.erro, /Não há valor disponível|passa do que ainda pode ser devolvido/);
        assert.equal((await C.query("SELECT status FROM public.devolucoes WHERE id=$1",[r.dev])).rows[0].status,"recebida");
      }
      const livre = await caso(dias, false);
      assert.equal(livre.linhas?.[0].r.reembolso_manual, dias > 180);
      assert.equal(Number(livre.linhas?.[0].r.valor_reembolso),100);
    }
    await conferir("67a-conferir-reembolso-manual-reserva-aplicado", true);
    // Ancestrais continuam positivos com o novo corpo (nao aceitar corpo desconhecido).
    assert((await C.query(ler("scripts/publicacao/consultas/43a-conferir-reembolso-em-duvida-aplicado.sql"))).rows.every(l=>l.ok));
    const def = (await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d",[SIG])).rows[0].d;
    await C.query(def.replace("AS $function$", "AS $function$\n-- divergente"));
    await conferir("67a-conferir-reembolso-manual-reserva-aplicado", false);
    assert.match((await tentar(migration)).erro,/B1_BASELINE_DIVERGENT/);
    assert.match((await tentar(rollback)).erro,/B1_BASELINE_DIVERGENT/);
    console.log("[reembolso-manual-reserva] PASSOU: controle antigo; 179/180/181 dias; reserva; sem reserva; ACL; reaplicar; rollback; pre-voo; consultas");
  } finally {
    await C.query("ROLLBACK");
    await C.end();
  }
}
main().catch(e=>{ console.error("[reembolso-manual-reserva] FALHOU:",e.message); process.exitCode=1; });
