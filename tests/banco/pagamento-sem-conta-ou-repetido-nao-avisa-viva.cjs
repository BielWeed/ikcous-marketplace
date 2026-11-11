"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja.
// MUTANTE_R100 seleciona uma sabotagem CIRURGICA do corpo/policy vivo.
// Fixtures e sabotagens sao desfeitas pelo ROLLBACK de cada caso.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const A = "b100c000-0000-4000-8000-000000000001";
const B = "b100c000-0000-4000-8000-000000000002";
const ADMIN = "b100c000-0000-4000-8000-000000000003";
const id = (n) => `b100c000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sessao = (uid) => ({
  uid,
  claims: JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: { role: uid === ADMIN ? "admin" : "customer" },
  }),
});

async function pessoa(uid, cargo = "customer") {
  await P.conexao().query(
    "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,$2,'{}')",
    [uid, `${uid}@r100.fixture.invalid`],
  );
  await P.conexao().query(
    "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Pessoa ficticia',$2)",
    [uid, cargo],
  );
}

async function mutar(nome, assinatura, trecho, substituto) {
  if (process.env.MUTANTE_R100 !== nome) return;
  const c = P.conexao();
  const original = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
      assinatura,
    ])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(
    original.split(trecho).length - 1,
    1,
    `mutante ${nome}: alvo deve ocorrer uma vez`,
  );
  const alterado = original.replace(trecho, substituto);
  assert.notEqual(alterado, original, "sabotagem nao aplicada");
  await c.query(alterado);
  const depois = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
      assinatura,
    ])
  ).rows[0].d.replace(/\r/g, "");
  assert.equal(depois, alterado, "o banco nao instalou exatamente o mutante");
  console.log(`MUTANTE aplicado: ${nome}`);
}

const FUNCAO = "public.notifica_cliente_de_mudanca_de_pagamento()";
async function preparar(uid) {
  const c = P.conexao();
  if (uid) await pessoa(uid);
  await c.query(
    `INSERT INTO public.marketplace_orders
    (id,user_id,customer_name,customer_data,total,subtotal,status,payment_method,payment_status)
    VALUES ($1,$2,'Pessoa ficticia','{}',10,10,'pending','online','aguardando')`,
    [id(10), uid],
  );
  await mutar(
    "pagamento-sem-guarda-conta",
    FUNCAO,
    `    IF NEW.user_id IS NULL THEN
        RETURN NEW;
    END IF;`,
    "",
  );
  await mutar(
    "pagamento-sem-guarda-repeticao",
    FUNCAO,
    `    IF OLD.payment_status IS NOT DISTINCT FROM NEW.payment_status THEN
        RETURN NEW;
    END IF;`,
    "",
  );
}
for (const status of ["pago", "pago_apos_expirar"]) {
  prova(`pedido sem conta virando ${status} nao gera aviso nem global`, () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await preparar(null);
      const antes = (
        await c.query("SELECT count(*)::int AS n FROM public.notificacoes")
      ).rows[0].n;
      await c.query(
        "UPDATE public.marketplace_orders SET payment_status=$2 WHERE id=$1",
        [id(10), status],
      );
      assert.equal(
        (
          await c.query(
            "SELECT payment_status FROM public.marketplace_orders WHERE id=$1",
            [id(10)],
          )
        ).rows[0].payment_status,
        status,
      );
      assert.equal(
        (await c.query("SELECT count(*)::int AS n FROM public.notificacoes"))
          .rows[0].n,
        antes,
        "pedido sem conta gerou aviso (inclusive global)",
      );
    }),
  );
  prova(`regravar ${status} da conta deixa exatamente um aviso`, () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await preparar(A);
      await c.query(
        "UPDATE public.marketplace_orders SET payment_status=$2 WHERE id=$1",
        [id(10), status],
      );
      const ler = async () =>
        (
          await c.query(
            "SELECT to_jsonb(n) AS n FROM public.notificacoes n WHERE dados->>'order_id'=$1 ORDER BY id",
            [id(10)],
          )
        ).rows.map((r) => r.n);
      const antes = await ler();
      assert.equal(antes.length, 1, "a primeira mudanca precisa avisar");
      assert.equal(antes[0].usuario_id, A);
      await c.query(
        "UPDATE public.marketplace_orders SET payment_status=$2 WHERE id=$1",
        [id(10), status],
      );
      assert.deepEqual(
        await ler(),
        antes,
        "regravar o pagamento duplicou o aviso",
      );
    }),
  );
}

async function main() {
  await P.conectar();
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("pagamento sem conta e repetido nao avisa");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
