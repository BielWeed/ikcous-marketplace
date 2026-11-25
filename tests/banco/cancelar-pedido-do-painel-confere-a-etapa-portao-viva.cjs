"use strict";
/**
 * Prova VIVA das consultas 159a/159b (cancelar o pedido do painel conferindo a etapa: pedido__mudar_status_com_etapa e
 * cancelar_pedido_do_painel novas, mais o corpo novo de pedido__mudar_status), com a migration 20261405700000 real. Mesmo molde
 * do portao 56 (conferencia-de-banco-comum.cjs): a base nasce do zero com SO as migrations anteriores (inclui a 20261405600000);
 * a 159b (antes) fica POSITIVA e a 159a reprova as 5 linhas das duas funcoes novas e do corpo de pedido__mudar_status; aplica a
 * 20261405700000 e a 159a fica POSITIVA nas 7 linhas, enquanto a 159b reprova as mesmas 5.
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`, nas TRES funcoes: corpo com outro
 * texto, sobrecarga, SECURITY INVOKER, STABLE/IMMUTABLE, STRICT, search_path trocado/sem fixo/com configuracao a mais, EXECUTE
 * para anon, PUBLIC ou service_role, authenticated ganhando a porta interna ou perdendo a do painel, funcao apagada. No antes,
 * alem disso, a migration "entrando pela metade" (uma das funcoes novas ja existe). O estrago "dono trocado" e' plantado tambem:
 * a consulta NAO o ve (ver o rotulo "ACHADO").
 *
 * Dado que ja existia: um pedido gravado antes da migration fica byte a byte depois dela e de reaplicar. Reaplicar e
 * idempotente: a 159a segue POSITIVA.
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma. O comportamento (a etapa conferida, as travas de
 * estorno e pedido) e' da prova viva da propria migration; aqui se prova a CONSULTA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/cancelar-pedido-do-painel-confere-a-etapa-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");
const { estragosDeFuncao } = require("./conferencia-de-funcao-estragos.cjs");

const A = "159a-conferir-cancelar-pedido-do-painel-confere-a-etapa-aplicado";
const B = "159b-antes-cancelar-pedido-do-painel-confere-a-etapa-base-vigente";
const ARQUIVO = "20261405700000_cancelar_pedido_do_painel_confere_a_etapa.sql";
const MUDAR =
  "public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)";
const ETAPA =
  "public.pedido__mudar_status_com_etapa(uuid,text,text,uuid,boolean,boolean,text)";
const PAINEL = "public.cancelar_pedido_do_painel(uuid,text,text)";
const U_CLI = "d1590000-0000-4000-8000-000000000001";
const PEDIDO = "d1590000-0000-4000-8000-000000000002";

const { rodarProva } = criarBancada({
  prefixo: "p159",
  arquivo: ARQUIVO,
  a: A,
  b: B,
  titulo: "Portao do cancelamento do painel que confere a etapa (159a/159b)",
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
    msCorpo: item(A, "pedido__mudar_status: corpo exato"),
    msAttrs: item(A, "pedido__mudar_status: assinatura"),
    ceCorpo: item(A, "pedido__mudar_status_com_etapa: corpo exato"),
    ceAttrs: item(A, "pedido__mudar_status_com_etapa: assinatura"),
    cpCorpo: item(A, "cancelar_pedido_do_painel: corpo exato"),
    cpAttrs: item(A, "cancelar_pedido_do_painel: assinatura"),
  };
  for (const [k, v] of Object.entries(i)) {
    assert.equal(item(B, v), v, `${k}: a 159b tem o mesmo rol`);
  }
  const NOVAS = [i.msCorpo, i.ceCorpo, i.ceAttrs, i.cpCorpo, i.cpAttrs];

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: um pedido gravado ANTES da migration.
  await usar(antes, async (c) => {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, 'cliente@portao159.teste', '{}'::jsonb)",
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
       VALUES ($1,$2,'Fixture 159','{}',100,100,0,'delivered','online','online','pago',now(),now(),'ORD159',0)`,
      [PEDIDO, U_CLI],
    );
  });
  const linhaDoPedido = async (c) =>
    (
      await c.query("SELECT * FROM public.marketplace_orders WHERE id = $1", [
        PEDIDO,
      ])
    ).rows;

  // As duas internas (nem anon, nem authenticated, nem service_role, nem PUBLIC executam) e a porta do painel (so authenticated).
  const doMudar = estragosDeFuncao({
    fn: MUDAR,
    nome: "pedido__mudar_status",
    volatilidade: "v",
    trocarCorpo,
    corpo: [i.msCorpo],
    estrutura: [i.msAttrs],
    drop: [i.msCorpo, i.msAttrs],
    anon: [i.msAttrs],
    publico: [i.msAttrs],
    authSem: null,
    authCom: [i.msAttrs],
    servicoCom: [i.msAttrs],
    dono: [],
    prefixoPapel: "p159a",
  });
  const daEtapa = estragosDeFuncao({
    fn: ETAPA,
    nome: "pedido__mudar_status_com_etapa",
    volatilidade: "v",
    trocarCorpo,
    corpo: [i.ceCorpo],
    estrutura: [i.ceAttrs],
    drop: [i.ceCorpo, i.ceAttrs],
    anon: [i.ceAttrs],
    publico: [i.ceAttrs],
    authSem: null,
    authCom: [i.ceAttrs],
    servicoCom: [i.ceAttrs],
    dono: [],
    prefixoPapel: "p159b",
  });
  const doPainel = estragosDeFuncao({
    fn: PAINEL,
    nome: "cancelar_pedido_do_painel",
    volatilidade: "v",
    trocarCorpo,
    corpo: [i.cpCorpo],
    estrutura: [i.cpAttrs],
    drop: [i.cpCorpo, i.cpAttrs],
    anon: [i.cpAttrs],
    publico: [i.cpAttrs],
    authSem: [i.cpAttrs],
    authCom: null,
    servicoCom: [i.cpAttrs],
    dono: [],
    prefixoPapel: "p159c",
  });
  // Os rotulos repetem entre as tres funcoes so no prefixo; o nome da funcao ja esta no texto de cada um.

  // ---------- ANTES: 159b positiva; 159a reprova as 5 linhas novas ----------
  await usar(antes, (c) =>
    emTransacao(c, async () => {
      await consulta(c, B);
      await consulta(c, A, NOVAS);
      // Na base so pedido__mudar_status existe (a 158): e' a unica que tem estrago por atributo; as outras duas tem de estar AUSENTES.
      for (const [rotulo, sql, itens] of doMudar) {
        await sabotar(c, rotulo, B, sql, itens);
      }
      await sabotar(
        c,
        "a migration entra pela metade: pedido__mudar_status_com_etapa ja existe",
        B,
        `CREATE FUNCTION public.pedido__mudar_status_com_etapa(p_order_id uuid, p_new_status text, p_notes text, p_ator uuid, p_ator_admin boolean, p_pela_edge boolean, p_status_esperado text)
           RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
        [i.ceCorpo, i.ceAttrs],
      );
      await sabotar(
        c,
        "a migration entra pela metade: cancelar_pedido_do_painel ja existe",
        B,
        `CREATE FUNCTION public.cancelar_pedido_do_painel(p_order_id uuid, p_status_esperado text, p_notes text DEFAULT NULL)
           RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
        [i.cpCorpo, i.cpAttrs],
      );
    }),
  );
  marcar(
    "159b positiva (7 linhas) e 159a reprova SO as 5 linhas novas na base criada com as migrations anteriores a 20261405700000",
  );

  // ---------- DEPOIS ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const antesDaMigration = await linhaDoPedido(c);
      assert.equal(antesDaMigration.length, 1, "o pedido ja existia");
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B, NOVAS);
      marcar(
        "159a: as 7 linhas ok=true apos aplicar a 20261405700000; 159b reprova SO as 5 linhas novas",
      );
      assert.deepEqual(await linhaDoPedido(c), antesDaMigration);
      marcar(
        "dado que ja existia: o pedido fica byte a byte depois da migration (so funcoes mudaram)",
      );
      await c.query(MIGRATION);
      await consulta(c, A);
      assert.deepEqual(await linhaDoPedido(c), antesDaMigration);
      marcar(
        "reaplicar a 20261405700000 deixa a 159a positiva e o pedido intacto (idempotente)",
      );
      for (const lista of [doMudar, daEtapa, doPainel]) {
        for (const [rotulo, sql, itens] of lista) {
          await sabotar(c, rotulo, A, sql, itens);
        }
      }
    }),
  );
});
