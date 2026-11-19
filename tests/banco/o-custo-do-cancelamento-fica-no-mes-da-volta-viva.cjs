"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const MIGRATION =
  "20261405900000_o_custo_do_cancelamento_fica_no_mes_da_volta.sql";
const ANTERIOR =
  "20261399600000_o_resultado_credita_o_custo_da_devolucao_de_outro_mes.sql";
const ADMIN = "7e7e4059-2000-4000-8000-000000000001";
const PRODUTO = "7e7e4059-2000-4000-8000-000000000002";
const DEVOLUCAO = "7e7e4059-2000-4000-8000-000000000003";
const ANO = "2041";
const ler = (nome) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Apenas migrations versionadas, de nomes fixos.
  readFileSync(
    path.join(__dirname, "../../supabase/migrations", nome),
    "utf8",
  ).replace(/\r/g, "");

async function semear(c) {
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1, 'admin@dre4059.invalid', '{"role":"admin"}')`,
    [ADMIN],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role)
     VALUES ($1, 'Admin Prova', 'admin') ON CONFLICT (id) DO UPDATE SET role = 'admin'`,
    [ADMIN],
  );
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto prova 4059', 50, 20, 100, true, false)`,
    [PRODUTO],
  );
}

async function vender(c, dia, quantidade) {
  const pagoEm = `${ANO}-${dia} 12:00:00-03`;
  const pedido = (
    await c.query(
      `INSERT INTO public.marketplace_orders
         (customer_name, customer_data, total, subtotal, status, canal, payment_method,
          payment_status, paid_at, created_at)
       VALUES ('Venda 4059', '{}', $1, $1, 'delivered', 'online', 'online', 'pago', $2, $2)
       RETURNING id`,
      [50 * quantidade, pagoEm],
    )
  ).rows[0].id;
  const item = (
    await c.query(
      `INSERT INTO public.marketplace_order_items
         (order_id, product_id, product_name, quantity, price)
       VALUES ($1, $2, 'Peça 4059', $3, 50)
       RETURNING id`,
      [pedido, PRODUTO, quantidade],
    )
  ).rows[0].id;
  return { pedido, item };
}

async function cancelar(c, pedido, volta, estorno = volta) {
  await c.query(
    `UPDATE public.marketplace_orders
        SET status = 'cancelled', payment_status = 'estornado',
            stock_returned_at = $2, estorno_manual_registrado_em = $3
      WHERE id = $1`,
    [pedido, `${ANO}-${volta}`, `${ANO}-${estorno}`],
  );
}

async function devolverUmaPeca(c, pedido, item) {
  const instante = `${ANO}-05-10 12:00:00-03`;
  await c.query(
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada,
        resolucao_final, modalidade, metodo_retorno, status, valor_itens,
        valor_reembolso, reembolso_manual, prazo_ate, politica, concluida_em)
     VALUES ($1, 'DV-PROVA-4059', $2, $3, 'arrependimento', 'desisti', 'reembolso',
        'reembolso', 'local', 'entrega_na_loja', 'concluida', 50, 50, true,
        current_date + 7, '{}'::jsonb, $4)`,
    [DEVOLUCAO, pedido, ADMIN, instante],
  );
  await c.query(
    `INSERT INTO public.devolucao_itens
       (devolucao_id, order_item_id, product_id, quantidade, valor_unitario, reestocado_em)
     VALUES ($1, $2, $3, 1, 50, $4)`,
    [DEVOLUCAO, item, PRODUTO, instante],
  );
}

const totais = async (c, de, ate) => {
  const { rows } = await c.query(
    "SELECT public.fin_dre($1::date, $2::date) AS resultado",
    [`${ANO}-${de}`, `${ANO}-${ate}`],
  );
  const { receita_bruta, deducoes, cmv, lucro_liquido, cmv_estimado } =
    rows[0].resultado;
  return [receita_bruta, deducoes, cmv, lucro_liquido, cmv_estimado];
};

async function conferirConsulta(c, consulta, positiva) {
  const { rows } = await c.query(
    ler(`../../scripts/publicacao/consultas/${consulta}.sql`),
  );
  assert.ok(rows.length > 0, consulta);
  assert.equal(
    rows.every((linha) => linha.ok),
    positiva,
    consulta,
  );
}

async function conferirPortao(c, novo) {
  await conferirConsulta(
    c,
    "161a-conferir-o-custo-do-cancelamento-fica-no-mes-da-volta-aplicado",
    novo,
  );
  await conferirConsulta(
    c,
    "161b-antes-o-custo-do-cancelamento-fica-no-mes-da-volta-base-vigente",
    !novo,
  );
  for (const consulta of [
    "8e-conferir-92-a-202-aplicado",
    "45a-conferir-custo-do-dia-aplicado",
    "87a-conferir-resultado-mostra-tarifa-juro-e-quebra-como-despesa-aplicado",
    "122a-conferir-o-resultado-credita-o-custo-da-devolucao-de-outro-mes-aplicado",
  ]) {
    await conferirConsulta(c, consulta, true);
  }
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await conferirPortao(c, true);
    await semear(c);
    const venda = await vender(c, "01-15", 2);
    const antes = [100, 0, 40, 60, false];
    const espera = async (de, ate, esperado) =>
      assert.deepEqual(await totais(c, de, ate), esperado, `${de} a ${ate}`);
    await espera("01-01", "01-31", antes);

    // Em UTC já é março, mas ainda é fevereiro na loja.
    await cancelar(c, venda.pedido, "03-01 01:00:00+00");
    const parcial = await vender(c, "04-12", 2);
    await devolverUmaPeca(c, parcial.pedido, parcial.item);
    await cancelar(c, parcial.pedido, "06-11 12:00:00-03");

    const mesmoDia = await vender(c, "07-10", 1);
    await cancelar(c, mesmoDia.pedido, "07-10 18:00:00-03");
    const estornoDepois = await vender(c, "08-10", 2);
    await cancelar(
      c,
      estornoDepois.pedido,
      "09-10 18:00:00-03",
      "10-10 18:00:00-03",
    );

    // O crédito deve usar o custo registrado na venda, não o preço de hoje.
    await c.query("UPDATE public.produtos SET custo = 99 WHERE id = $1", [
      PRODUTO,
    ]);
    await espera("01-01", "01-31", antes);
    await espera("02-01", "02-28", [0, 100, -40, -60, false]);
    await espera("01-01", "02-28", [100, 100, 0, 0, false]);
    await espera("03-01", "03-31", [0, 0, 0, 0, false]);
    await espera("04-01", "04-30", antes);
    await espera("05-01", "05-31", [0, 50, -20, -30, false]);
    await espera("06-01", "06-30", [0, 50, -20, -30, false]);
    await espera("04-01", "06-30", [100, 100, 0, 0, false]);
    await espera("07-01", "07-31", [50, 50, 0, 0, false]);
    await espera("08-01", "08-31", antes);
    await espera("09-01", "09-30", [0, 0, -40, 40, false]);
    await espera("10-01", "10-31", [0, 100, 0, -100, false]);

    // Controle negativo no MESMO dado + rollback byte a byte.
    await c.query(ler(`rollback-manual-${MIGRATION}`));
    await conferirPortao(c, false);
    const corpo = (
      await c.query(
        "SELECT prosrc FROM pg_proc WHERE oid = 'public.fin_dre(date,date)'::regprocedure",
      )
    ).rows[0].prosrc.replace(/\r/g, "");
    const corpoAnterior = ler(ANTERIOR).split("AS $$")[1].split("$$;")[0];
    assert.equal(corpo, corpoAnterior);
    await espera("01-01", "01-31", [100, 0, 0, 100, false]);
    await espera("02-01", "02-28", [0, 100, 0, -100, false]);
    await c.query(ler(MIGRATION));
    await espera("01-01", "01-31", antes);
    console.log(
      "OK: venda preservada, crédito no mês da volta, parcial sem duplicar, rollback byte a byte",
    );
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
