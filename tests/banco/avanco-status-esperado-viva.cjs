"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Caminhos compostos apenas de nomes fixos de migrations/consultas deste repositorio;
 * nenhum caminho vem de rede, de credencial ou de entrada de usuario. */
// Apenas o Postgres descartavel do CI. Duas conexoes reais, nenhuma loja.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const ROOT = path.resolve(__dirname, "../..");
const ARQ = "20261345000000_o_avanco_confere_o_status_esperado.sql";
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const migration = ler(`supabase/migrations/${ARQ}`);
const rollback = ler(`supabase/migrations/rollback-manual-${ARQ}`);
const SIG = "public.avancar_status_do_pedido(uuid,text,text,text)";
const C = new Client({ connectionString: lerDatabaseUrlEfemera() });
const D = new Client({ connectionString: lerDatabaseUrlEfemera() });
const ADMIN = "ad345000-0000-4000-8000-000000000001";
const CLIENTE = "ad345000-0000-4000-8000-000000000002";
let seq = 0;
const id = () => `ad345000-0001-4000-8000-${String(++seq).padStart(12, "0")}`;
async function como(c, uid = ADMIN, papel = "authenticated") {
  await c.query(
    "SELECT set_config('app.rpc.user_id',$1,true),set_config('request.jwt.claims',$2,true)",
    [
      uid,
      JSON.stringify({
        role: papel,
        app_metadata: { role: uid === ADMIN ? "admin" : "customer" },
      }),
    ],
  );
  if (papel === "authenticated") await c.query("SET LOCAL ROLE authenticated");
  else if (papel === "anon") await c.query("SET LOCAL ROLE anon");
  else await c.query("SET LOCAL ROLE service_role");
}
async function tentar(sql, params = [], uid = ADMIN, papel = "authenticated") {
  await C.query("SAVEPOINT tentativa");
  try {
    await como(C, uid, papel);
    const r = await C.query(sql, params);
    await C.query("RESET ROLE");
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas: r.rows };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { codigo: e.code, erro: e.message };
  }
}
async function pedido(status = "processing") {
  const oid = id();
  await C.query(
    `INSERT INTO public.marketplace_orders
    (id,user_id,customer_name,customer_data,total,subtotal,shipping,status,payment_method,payment_status,paid_at)
    VALUES($1,$2,'Fixture CAS','{}',100,100,0,$3,'online','pago',now())`,
    [oid, CLIENTE, status],
  );
  return oid;
}
async function foto(oid) {
  return (
    await C.query(
      `SELECT to_jsonb(o) AS pedido,
    (SELECT count(*)::int FROM public.marketplace_order_history h WHERE h.order_id=o.id) AS historico,
    (SELECT count(*)::int FROM public.order_refunds r WHERE r.order_id=o.id) AS refunds
    FROM public.marketplace_orders o WHERE o.id=$1`,
      [oid],
    )
  ).rows[0];
}
const SQL = "SELECT public.avancar_status_do_pedido($1,$2,$3,$4) AS r";
async function conferir(nome, passa, c = C) {
  const linhas = (
    await c.query(ler(`scripts/publicacao/consultas/${nome}.sql`))
  ).rows;
  assert.equal(linhas.length, 4);
  assert.equal(
    linhas.every((l) => l.ok),
    passa,
    JSON.stringify(linhas),
  );
}
async function hash(c, sig) {
  return (
    (
      await c.query(
        "SELECT md5(replace(prosrc,chr(13),'')) AS h FROM pg_proc WHERE oid=to_regprocedure($1)",
        [sig],
      )
    ).rows[0]?.h ?? null
  );
}
async function main() {
  await C.connect();
  await D.connect();
  await C.query("BEGIN");
  try {
    const antigas =
      await C.query(`SELECT oid::regprocedure::text AS sig,prosrc,proacl::text,proconfig,prosecdef FROM pg_proc
      WHERE oid IN(to_regprocedure('public.update_order_status_atomic(uuid,text,text,boolean)'),
        to_regprocedure('public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)')) ORDER BY 1`);
    await conferir("68a-conferir-avanco-status-esperado-aplicado", true);
    await conferir("68b-antes-avanco-status-esperado", false);
    await C.query(rollback);
    assert.equal(await hash(C, SIG), null);
    await conferir("68b-antes-avanco-status-esperado", true);
    await C.query(migration);
    await C.query(migration);
    assert.equal(await hash(C, SIG), "fa38bcea0cc69ffff200d8e2c81bd0d3");
    assert.deepEqual(
      (
        await C.query(`SELECT oid::regprocedure::text AS sig,prosrc,proacl::text,proconfig,prosecdef FROM pg_proc
      WHERE oid IN(to_regprocedure('public.update_order_status_atomic(uuid,text,text,boolean)'),
        to_regprocedure('public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)')) ORDER BY 1`)
      ).rows,
      antigas.rows,
    );
    await C.query(
      `INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
      ($1,'admin345@fixture.test','{"role":"admin"}'),($2,'cliente345@fixture.test','{}')`,
      [ADMIN, CLIENTE],
    );
    await C.query(
      `INSERT INTO public.profiles(id,full_name,role) VALUES
      ($1,'Admin fixture','admin'),($2,'Cliente fixture','customer')`,
      [ADMIN, CLIENTE],
    );
    const oid = await pedido();
    for (const status of ["cancelled", "shipping", "delivered"]) {
      await C.query(
        "UPDATE public.marketplace_orders SET status=$2 WHERE id=$1",
        [oid, status],
      );
      const antes = await foto(oid);
      const r = await tentar(SQL, [oid, "processing", "shipping", null]);
      assert.match(r.erro ?? "", /pedido_status_mudou/);
      assert.deepEqual(
        await foto(oid),
        antes,
        "conflito nao altera dinheiro/estoque/historico",
      );
    }
    await C.query(
      "UPDATE public.marketplace_orders SET status='processing' WHERE id=$1",
      [oid],
    );
    const antes = await foto(oid);
    for (const [uid, papel] of [
      [CLIENTE, "authenticated"],
      [ADMIN, "anon"],
      [ADMIN, "service_role"],
    ]) {
      const r = await tentar(
        SQL,
        [oid, "processing", "shipping", null],
        uid,
        papel,
      );
      assert.equal(r.codigo, "42501");
      assert.deepEqual(await foto(oid), antes);
    }
    // JWT antigo ainda diz admin, mas o papel no banco foi rebaixado.
    await C.query("UPDATE auth.users SET raw_app_meta_data='{}' WHERE id=$1", [
      ADMIN,
    ]);
    assert.equal(
      (await tentar(SQL, [oid, "processing", "shipping", null])).codigo,
      "42501",
    );
    await C.query(
      `UPDATE auth.users SET raw_app_meta_data='{"role":"admin"}' WHERE id=$1`,
      [ADMIN],
    );
    assert.equal(
      (await tentar(SQL, [oid, null, "shipping", null])).codigo,
      "P0001",
    );
    assert.equal(
      (await tentar(SQL, [oid, "processing", "cancelled", null])).codigo,
      "22023",
    );
    const ok = await tentar(SQL, [oid, "processing", "shipping", "fixture"]);
    assert.equal(ok.linhas?.[0].r.status, "shipping");
    assert.equal((await foto(oid)).historico, antes.historico + 1);
    assert.match(
      (await tentar(SQL, [oid, "processing", "shipping", null])).erro,
      /pedido_status_mudou/,
    );
    await C.query("COMMIT"); // somente o clone efemero; necessario para a outra conexao ver a fixture.
    // Corrida real: D le o pedido SOMENTE depois de a trava de C ser solta.
    for (const destino of ["shipping", "cancelled"]) {
      await C.query("BEGIN");
      const corrida = await pedido();
      await C.query("COMMIT");
      await C.query("BEGIN");
      await C.query(
        "UPDATE public.marketplace_orders SET status=$2 WHERE id=$1",
        [corrida, destino],
      );
      await D.query("BEGIN");
      await D.query("SET LOCAL statement_timeout='5s'");
      await como(D);
      const pid = (await D.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const pendente = D.query(SQL, [
        corrida,
        "processing",
        "shipping",
        null,
      ]).then(
        (r) => ({ r }),
        (e) => ({ e }),
      );
      let esperou = false;
      for (let i = 0; i < 80; i++) {
        if (
          (
            await C.query(
              "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",
              [pid],
            )
          ).rows[0]?.wait_event_type === "Lock"
        ) {
          esperou = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(
        esperou,
        true,
        "a RPC precisa esperar a trava real do pedido",
      );
      await C.query("COMMIT");
      const fim = await pendente;
      assert.match(fim.e?.message ?? "", /pedido_status_mudou/);
      await D.query("ROLLBACK");
      assert.equal((await foto(corrida)).pedido.status, destino);
      assert.equal((await foto(corrida)).historico, 0);
    }
    await C.query("BEGIN");
    const def = (
      await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
        SIG,
      ])
    ).rows[0].d;
    await C.query(def.replace("AS $function$", "AS $function$\n-- divergente"));
    await conferir("68a-conferir-avanco-status-esperado-aplicado", false);
    await C.query("SAVEPOINT desconhecido");
    await assert.rejects(C.query(migration), /B1_BASELINE_DIVERGENT/);
    await C.query("ROLLBACK TO SAVEPOINT desconhecido");
    await assert.rejects(C.query(rollback), /B1_BASELINE_DIVERGENT/);
    await C.query("ROLLBACK");
    console.log(
      "[avanco-status-esperado] PASSOU: comparacao atomica, concorrencia real, admin atual, ACL, rollback e portas antigas intactas",
    );
  } finally {
    await C.query("ROLLBACK").catch(() => {});
    await D.query("ROLLBACK").catch(() => {});
    await C.end();
    await D.end();
  }
}
main().catch((e) => {
  console.error("[avanco-status-esperado] FALHOU:", e.message);
  process.exitCode = 1;
});
