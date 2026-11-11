"use strict";

// Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja.
// MUTANTE_R100 seleciona uma sabotagem CIRURGICA do corpo/policy vivo.
// Fixtures e sabotagens sao desfeitas pelo ROLLBACK de cada caso.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const id = (n) => `b100c000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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
  "estorno na mesma instrucao preserva data do mes anterior e sai naquele periodo",
  () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      const datas = (
        await c.query(`SELECT
    ((date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 month')::date + 14)::text AS antigo,
    date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS inicio,
    public.fin__hoje()::text AS hoje`)
      ).rows[0];
      await c.query(
        `INSERT INTO public.marketplace_orders
    (id,customer_name,customer_data,total,subtotal,status,payment_method,payment_status,paid_at)
    VALUES ($1,'Pessoa ficticia','{}',37,37,'cancelled','online','pago',($2::date+time '12:00') AT TIME ZONE 'America/Sao_Paulo')`,
        [id(10), datas.antigo],
      );
      await mutar(
        "estorno-sobrescreve-data",
        "public.marca_estorno_direto_do_pedido()",
        "COALESCE(NEW.estorno_manual_registrado_em, now())",
        "now()",
      );
      await c.query(
        `UPDATE public.marketplace_orders SET payment_status='estornado',
    estorno_manual_registrado_em=($2::date+time '12:00') AT TIME ZONE 'America/Sao_Paulo' WHERE id=$1`,
        [id(10), datas.antigo],
      );
      const carimbo = (
        await c.query(
          "SELECT public.fin__dia(estorno_manual_registrado_em)::text AS dia FROM public.marketplace_orders WHERE id=$1",
          [id(10)],
        )
      ).rows[0].dia;
      assert.equal(
        carimbo,
        datas.antigo,
        "gatilho sobrescreveu data de estorno informada",
      );
      assert.equal(
        (
          await c.query(
            `SELECT estorno_manual_registrado_em =
    ($2::date+time '12:00') AT TIME ZONE 'America/Sao_Paulo' AS preservou
    FROM public.marketplace_orders WHERE id=$1`,
            [id(10), datas.antigo],
          )
        ).rows[0].preservou,
        true,
        "gatilho mudou o instante informado",
      );
      const movimento = (
        await c.query(
          `SELECT origem,valor::text,data::text FROM public.fin__movimentos($1::date,$2::date)
    WHERE pedido_id=$3 AND origem='estorno_externo'`,
          [datas.antigo, datas.antigo, id(10)],
        )
      ).rows;
      assert.deepEqual(
        movimento,
        [{ origem: "estorno_externo", valor: "37.00", data: datas.antigo }],
        "estorno nao caiu no periodo antigo",
      );
      assert.deepEqual(
        (
          await c.query(
            "SELECT id FROM public.fin__movimentos($1::date,$2::date) WHERE pedido_id=$3 AND origem='estorno_externo'",
            [datas.inicio, datas.hoje, id(10)],
          )
        ).rows,
        [],
        "estorno vazou para o mes atual",
      );
    }),
);

async function main() {
  await P.conectar();
  await P.conexao().query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
  try {
    await P.executar("estorno preserva data informada");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
