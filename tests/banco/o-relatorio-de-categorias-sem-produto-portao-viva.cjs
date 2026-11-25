"use strict";
/**
 * Prova VIVA das consultas 164a/164b (o relatorio de vendas por categoria nao da a uma categoria o dinheiro de item sem
 * produto: get_category_analytics com o corpo novo), com a migration 20261409000000 real. Mesmo molde do portao 56
 * (conferencia-de-banco-comum.cjs): a base nasce do zero com SO as migrations anteriores; a 164b (antes) fica POSITIVA e a
 * 164a reprova SO o corpo; aplica a 20261409000000 e a 164a fica POSITIVA nas 2 linhas.
 *
 * ATENCAO ao desenho da 164b: ela aceita o corpo VIGENTE e tambem o NOVO ("a prova aceita tambem a versao nova para uma
 * reaplicacao idempotente"). Por isso, DEPOIS da migration, a 164b tambem fica POSITIVA (nao reprova o corpo, ao contrario dos
 * outros lotes). A prova trava esse comportamento: se a 164b voltasse a recusar o corpo novo, ou aceitasse um terceiro, ela acusa.
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`: corpo com outro texto, sobrecarga,
 * SECURITY INVOKER, STABLE/IMMUTABLE, STRICT, search_path trocado/sem fixo/com configuracao a mais, funcao apagada.
 *
 * ACHADOS (a consulta e' so de corpo e atributos; o rol NAO tem linha de ACL nem de dono): anon ou PUBLIC ganhando EXECUTE em
 * get_category_analytics, authenticated perdendo o EXECUTE e o dono trocado passam POSITIVOS. A migration diz "preserva as
 * permissoes", mas a consulta nao as confere; quem barra o visitante hoje e' o proprio corpo (is_admin() e is_admin_atual()),
 * que o md5 trava. Plantados aqui com o rotulo "ACHADO": a prova exige que a consulta continue sem ve-los, para a lacuna ficar
 * escrita; se a consulta passar a ver, a prova acusa e alguem decide.
 *
 * Dado que ja existia: um pedido com um item sem produto vinculado (o caso do defeito), gravado antes da migration, fica byte a
 * byte depois dela e de reaplicar. Reaplicar e idempotente.
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma. O comportamento (o dinheiro do item sem produto nao
 * vai para outra categoria) e' da prova analise-por-categoria-*-viva.cjs; aqui se prova a CONSULTA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-relatorio-de-categorias-sem-produto-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");
const { estragosDeFuncao } = require("./conferencia-de-funcao-estragos.cjs");

const A = "164a-conferir-o-relatorio-de-categorias-sem-produto-aplicado";
const B = "164b-antes-o-relatorio-de-categorias-sem-produto-base-vigente";
const ARQUIVO =
  "20261409000000_o_relatorio_de_categorias_nao_da_a_uma_categoria_o_dinheiro_de_item_sem_produto.sql";
const FN =
  "public.get_category_analytics(timestamp with time zone,timestamp with time zone)";
const U_CLI = "d1640000-0000-4000-8000-000000000001";
const PEDIDO = "d1640000-0000-4000-8000-000000000002";

const { rodarProva } = criarBancada({
  prefixo: "p164",
  arquivo: ARQUIVO,
  a: A,
  b: B,
  titulo: "Portao do relatorio de categorias com item sem produto (164a/164b)",
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
    assert.equal(item(B, v.slice(0, 36)), v, `${k}: a 164b tem o mesmo rol`);
  }

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: um pedido pago com um item SEM produto vinculado, gravado ANTES da migration.
  await usar(antes, async (c) => {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, 'cliente@portao164.teste', '{}'::jsonb)",
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
       VALUES ($1,$2,'Fixture 164','{}',100,100,0,'delivered','online','online','pago',now(),now(),'ORD164',0)`,
      [PEDIDO, U_CLI],
    );
    await c.query(
      `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
       VALUES ($1, NULL, 'Item sem produto', 1, 100)`,
      [PEDIDO],
    );
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
  });

  const comuns = estragosDeFuncao({
    fn: FN,
    nome: "get_category_analytics",
    volatilidade: "v",
    trocarCorpo,
    corpo: [i.corpo],
    estrutura: [i.attrs],
    drop: [i.corpo, i.attrs],
    // A 164 so le corpo e atributos: nenhuma destas famílias e' vista (achados).
    anon: [],
    publico: [],
    authSem: [],
    authCom: null,
    servicoCom: null,
    dono: [],
    prefixoPapel: "p164",
  });

  // ---------- ANTES: 164b positiva; 164a reprova so o corpo ----------
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
    "164b positiva (2 linhas) e 164a reprova SO o corpo na base criada com as migrations anteriores a 20261409000000",
  );

  // ---------- DEPOIS ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const antesDaMigration = await dadosDoPedido(c);
      assert.equal(antesDaMigration.pedido.length, 1, "o pedido ja existia");
      assert.equal(antesDaMigration.itens.length, 1, "o item ja existia");
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B);
      marcar(
        "164a: as 2 linhas ok=true apos aplicar a 20261409000000; a 164b aceita o corpo novo e tambem fica POSITIVA (de proposito, para reaplicar)",
      );
      assert.deepEqual(await dadosDoPedido(c), antesDaMigration);
      marcar(
        "dado que ja existia: o pedido e o item sem produto ficam byte a byte depois da migration (so o texto da funcao mudou)",
      );
      await c.query(MIGRATION);
      await consulta(c, A);
      assert.deepEqual(await dadosDoPedido(c), antesDaMigration);
      marcar(
        "reaplicar a 20261409000000 deixa a 164a positiva e os dados intactos (idempotente)",
      );
      for (const [rotulo, sql, itens] of comuns) {
        await sabotar(c, rotulo, A, sql, itens);
      }
      // A 164b tambem enxerga o corpo trocado, o que a 164a ja mostrou: a mesma sabotagem reprova as duas.
      await sabotar(
        c,
        "corpo de get_category_analytics com outro texto, visto pela 164b depois da migration",
        B,
        (cc) => trocarCorpo(cc, FN),
        [i.corpo],
      );
    }),
  );
});
