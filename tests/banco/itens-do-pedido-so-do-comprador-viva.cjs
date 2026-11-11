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

prova(
  "cada comprador le exatamente seus itens; filtro de item alheio devolve zero",
  () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await pessoa(A);
      await pessoa(B);
      for (const [uid, pedido, item] of [
        [A, id(10), id(20)],
        [B, id(11), id(21)],
      ]) {
        await c.query(
          `INSERT INTO public.marketplace_orders
        (id,user_id,customer_name,customer_data,total,subtotal,status,payment_method)
        VALUES ($1,$2,'Pessoa ficticia','{}',10,10,'pending','cash')`,
          [pedido, uid],
        );
        await c.query(
          "INSERT INTO public.marketplace_order_items (id,order_id,product_name,quantity,price) VALUES ($1,$2,'Item ficticio',1,10)",
          [item, pedido],
        );
      }
      if (process.env.MUTANTE_R100 === "itens-sem-vinculo") {
        const qual = (
          await c.query(
            "SELECT pg_get_expr(polqual,polrelid) AS q FROM pg_policy WHERE polrelid='public.marketplace_order_items'::regclass AND polname='order_items_select_policy'",
          )
        ).rows[0].q;
        const alvo = "(mo.id = marketplace_order_items.order_id)";
        assert.equal(
          qual.split(alvo).length - 1,
          1,
          "a policy deve ter um vinculo por pedido",
        );
        await c.query(
          `ALTER POLICY order_items_select_policy ON public.marketplace_order_items USING (${qual.replace(alvo, "true")})`,
        );
        console.log("MUTANTE aplicado: itens-sem-vinculo");
      }
      for (const [uid, proprio, alheio] of [
        [A, id(20), id(21)],
        [B, id(21), id(20)],
      ]) {
        assert.deepEqual(
          await P.como(
            "authenticated",
            "SELECT current_user AS papel,auth.uid() AS uid",
            [],
            sessao(uid),
          ),
          [{ papel: "authenticated", uid }],
        );
        assert.deepEqual(
          await P.como(
            "authenticated",
            "SELECT id FROM public.marketplace_order_items ORDER BY id",
            [],
            sessao(uid),
          ),
          [{ id: proprio }],
          "RLS revelou item de outro comprador",
        );
        assert.deepEqual(
          await P.como(
            "authenticated",
            "SELECT id FROM public.marketplace_order_items WHERE id=$1",
            [alheio],
            sessao(uid),
          ),
          [],
          "item alheio ficou visivel",
        );
      }
    }),
);

async function main() {
  await P.conectar();
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("itens isolados por comprador");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
