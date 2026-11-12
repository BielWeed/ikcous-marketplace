"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja.
// MUTANTE_R100 seleciona uma sabotagem CIRURGICA do corpo/policy vivo.
// Fixtures e sabotagens sao desfeitas pelo ROLLBACK de cada caso.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const A = "b100c000-0000-4000-8000-000000000001";
const id = (n) => `b100c000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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
  "devolucao SEM reestoque nao desconta credito: duas unidades voltam uma unica vez",
  () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await pessoa(A);
      await c.query(
        "INSERT INTO public.produtos (id,nome,preco_venda,estoque,ativo) VALUES ($1,'Produto ficticio',10,8,true)",
        [id(10)],
      );
      await c.query(
        `INSERT INTO public.marketplace_orders (id,user_id,customer_name,customer_data,total,subtotal,status,payment_method,payment_status)
    VALUES ($1,$2,'Pessoa ficticia','{}',20,20,'delivered','cash','recebido_na_entrega')`,
        [id(11), A],
      );
      await c.query(
        "INSERT INTO public.marketplace_order_items (id,order_id,product_id,product_name,quantity,price) VALUES ($1,$2,$3,'Produto ficticio',2,10)",
        [id(12), id(11), id(10)],
      );
      await c.query(
        `INSERT INTO public.devolucoes
    (id,protocolo,order_id,user_id,tipo,motivo,resolucao_desejada,modalidade,metodo_retorno,status,valor_itens,prazo_ate,politica)
    VALUES ($1,'R100-FICTICIO',$2,$3,'arrependimento','desisti','reembolso','local','entrega_na_loja','solicitada',10,current_date+7,'{}')`,
        [id(13), id(11), A],
      );
      await c.query(
        `INSERT INTO public.devolucao_itens (devolucao_id,order_item_id,product_id,quantidade,valor_unitario,reestocado_em)
    VALUES ($1,$2,$3,1,10,NULL)`,
        [id(13), id(12), id(10)],
      );
      assert.equal(
        (
          await c.query(
            "SELECT reestocado_em FROM public.devolucao_itens WHERE order_item_id=$1",
            [id(12)],
          )
        ).rows[0].reestocado_em,
        null,
      );
      await mutar(
        "estoque-desconta-sem-reestoque",
        "public.devolver_estoque(uuid)",
        " AND di.reestocado_em IS NOT NULL",
        "",
      );
      const antes = Number(
        (
          await c.query("SELECT estoque FROM public.produtos WHERE id=$1", [
            id(10),
          ])
        ).rows[0].estoque,
      );
      assert.equal(
        (await c.query("SELECT public.devolver_estoque($1) AS n", [id(11)]))
          .rows[0].n,
        2,
        "devolucao nao reestocada descontou unidade do credito",
      );
      assert.equal(
        Number(
          (
            await c.query("SELECT estoque FROM public.produtos WHERE id=$1", [
              id(10),
            ])
          ).rows[0].estoque,
        ),
        antes + 2,
      );
      assert.ok(
        (
          await c.query(
            "SELECT stock_returned_at FROM public.marketplace_orders WHERE id=$1",
            [id(11)],
          )
        ).rows[0].stock_returned_at,
      );
      assert.equal(
        (await c.query("SELECT public.devolver_estoque($1) AS n", [id(11)]))
          .rows[0].n,
        0,
        "segunda chamada creditou de novo",
      );
      assert.equal(
        Number(
          (
            await c.query("SELECT estoque FROM public.produtos WHERE id=$1", [
              id(10),
            ])
          ).rows[0].estoque,
        ),
        antes + 2,
      );
    }),
);

async function main() {
  await P.conectar();
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("estoque considera somente reestoque feito");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
