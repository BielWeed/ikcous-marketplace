"use strict";
/**
 * Prova VIVA das consultas 198a/198b (a soma das categorias fecha com o faturamento no centavo: get_category_analytics com o
 * corpo do maior resto), com a migration 20261620000000 real. Mesmo molde do portao 164
 * (o-relatorio-de-categorias-sem-produto-portao-viva.cjs, conferencia-de-banco-comum.cjs): a base nasce do zero com SO as
 * migrations anteriores (a 20261409000000 no ar); a 198b (antes) fica POSITIVA e a 198a reprova SO o corpo; aplica a
 * 20261620000000 e a 198a fica POSITIVA nas 2 linhas.
 *
 * Desenho da 198b (o mesmo da 164b): ela aceita o corpo VIGENTE (o da 1409) e tambem o NOVO, para uma reaplicacao
 * idempotente. Por isso, DEPOIS da migration, a 198b tambem fica POSITIVA. A prova trava esse comportamento: se a 198b
 * voltasse a recusar o corpo novo, ou aceitasse um terceiro, ela acusa.
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`: corpo com outro texto, sobrecarga,
 * SECURITY INVOKER, STABLE/IMMUTABLE, STRICT, search_path trocado/sem fixo/com configuracao a mais, funcao apagada.
 *
 * ACHADOS (a consulta e' so de corpo e atributos; o rol NAO tem linha de ACL nem de dono, como a 164): anon ou PUBLIC
 * ganhando EXECUTE, authenticated perdendo o EXECUTE e o dono trocado passam POSITIVOS. Quem barra o visitante e' o proprio
 * corpo (is_admin() e is_admin_atual()), que o md5 trava. Plantados com o rotulo "ACHADO": a prova exige que a consulta
 * continue sem ve-los, para a lacuna ficar escrita.
 *
 * Dado que ja existia: um pedido pago de R$ 10,00 com itens de tres categorias (o caso do defeito), gravado antes da
 * migration, fica byte a byte depois dela e de reaplicar. Reaplicar e idempotente.
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma. O comportamento (3,34 + 3,33 + 3,33) e' da prova
 * analise-por-categoria-so-conta-pedido-pago-viva.cjs; aqui se prova a CONSULTA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-soma-das-categorias-fecha-no-centavo-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");
const { estragosDeFuncao } = require("./conferencia-de-funcao-estragos.cjs");

const A = "198a-conferir-a-soma-das-categorias-fecha-no-centavo-aplicado";
const B = "198b-antes-a-soma-das-categorias-fecha-no-centavo-base-vigente";
const ARQUIVO =
  "20261620000000_a_soma_das_categorias_fecha_com_o_faturamento_no_centavo.sql";
const FN =
  "public.get_category_analytics(timestamp with time zone,timestamp with time zone)";
const U_CLI = "d1980000-0000-4000-8000-000000000001";
const PEDIDO = "d1980000-0000-4000-8000-000000000002";
const PRODUTOS = [
  ["d1980000-0000-4000-8000-000000000011", "Categoria A portao 198"],
  ["d1980000-0000-4000-8000-000000000012", "Categoria B portao 198"],
  ["d1980000-0000-4000-8000-000000000013", "Categoria C portao 198"],
];

const { rodarProva } = criarBancada({
  prefixo: "p198",
  arquivo: ARQUIVO,
  a: A,
  b: B,
  titulo: "Portao da soma das categorias no centavo (198a/198b)",
});

rodarProva(async (H) => {
  const {
    MIGRATION,
    usar,
    criar,
    montarBase,
    emTransacao,
    consulta,
    item,
    sabotar,
    trocarCorpo,
    marcar,
  } = H;
  const i = {
    corpo: item(A, "get_category_analytics: corpo exato"),
    attrs: item(A, "get_category_analytics: assinatura e atributos"),
  };
  for (const [k, v] of Object.entries(i)) {
    assert.equal(item(B, v.slice(0, 36)), v, `${k}: a 198b tem o mesmo rol`);
  }

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: um pedido pago de R$ 10,00 com tres itens de R$ 1,00, cada um de uma categoria, gravado ANTES.
  await usar(antes, async (c) => {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, 'cliente@portao198.teste', '{}'::jsonb)",
      [U_CLI],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente Prova', 'customer')",
      [U_CLI],
    );
    await c.query(
      `INSERT INTO public.marketplace_orders
         (id,user_id,customer_name,customer_data,total,subtotal,shipping,status,canal,payment_method,payment_status,paid_at,
          pagamento_recebido_em,gateway_payment_id,valor_estornado)
       VALUES ($1,$2,'Fixture 198','{}',10,3,7,'delivered','online','online','pago',now(),now(),'ORD198',0)`,
      [PEDIDO, U_CLI],
    );
    for (const [produto, categoria] of PRODUTOS) {
      await c.query(
        `INSERT INTO public.produtos (id, nome, categoria, preco_venda, custo, estoque, ativo)
         VALUES ($1, 'Produto prova 198', $2, 1, 0, 10, true)`,
        [produto, categoria],
      );
      await c.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
         VALUES ($1, $2, 'Produto prova 198', 1, 1)`,
        [PEDIDO, produto],
      );
    }
  });
  const dadosDoPedido = async (c) => ({
    pedido: (
      await c.query("SELECT * FROM public.marketplace_orders WHERE id = $1", [
        PEDIDO,
      ])
    ).rows,
    itens: (
      await c.query(
        "SELECT * FROM public.marketplace_order_items WHERE order_id = $1 ORDER BY id",
        [PEDIDO],
      )
    ).rows,
    produtos: (
      await c.query(
        "SELECT * FROM public.produtos WHERE id = ANY($1::uuid[]) ORDER BY id",
        [PRODUTOS.map(([id]) => id)],
      )
    ).rows,
  });

  const comuns = estragosDeFuncao({
    fn: FN,
    nome: "get_category_analytics",
    volatilidade: "v",
    trocarCorpo,
    corpo: [i.corpo],
    estrutura: [i.attrs],
    drop: [i.corpo, i.attrs],
    // A 198 so le corpo e atributos: nenhuma destas familias e' vista (achados).
    anon: [],
    publico: [],
    authSem: [],
    authCom: null,
    servicoCom: null,
    dono: [],
    prefixoPapel: "p198",
  });

  // ---------- ANTES: 198b positiva; 198a reprova so o corpo ----------
  await usar(antes, (c) =>
    emTransacao(c, async () => {
      await consulta(c, B);
      await consulta(c, A, [i.corpo]);
      for (const [rotulo, sql, itens] of comuns) {
        await sabotar(c, rotulo, B, sql, itens);
      }
    }),
  );
  marcar(
    "198b positiva (2 linhas) e 198a reprova SO o corpo na base criada com as migrations anteriores a 20261620000000",
  );

  // ---------- DEPOIS ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const antesDaMigration = await dadosDoPedido(c);
      assert.equal(antesDaMigration.pedido.length, 1, "o pedido ja existia");
      assert.equal(antesDaMigration.itens.length, 3, "os itens ja existiam");
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B);
      marcar(
        "198a: as 2 linhas ok=true apos aplicar a 20261620000000; a 198b aceita o corpo novo e tambem fica POSITIVA (de proposito, para reaplicar)",
      );
      assert.deepEqual(await dadosDoPedido(c), antesDaMigration);
      marcar(
        "dado que ja existia: o pedido, os itens e os produtos ficam byte a byte depois da migration (so o texto da funcao mudou)",
      );
      await c.query(MIGRATION);
      await consulta(c, A);
      assert.deepEqual(await dadosDoPedido(c), antesDaMigration);
      marcar(
        "reaplicar a 20261620000000 deixa a 198a positiva e os dados intactos (idempotente)",
      );
      for (const [rotulo, sql, itens] of comuns) {
        await sabotar(c, rotulo, A, sql, itens);
      }
      // A 198b tambem enxerga o corpo trocado: a mesma sabotagem reprova as duas.
      await sabotar(
        c,
        "corpo de get_category_analytics com outro texto, visto pela 198b depois da migration",
        B,
        (cc) => trocarCorpo(cc, FN),
        [i.corpo],
      );
    }),
  );
});
