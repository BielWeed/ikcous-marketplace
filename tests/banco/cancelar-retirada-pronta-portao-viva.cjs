"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * O arquivo lido e' uma migration do repositorio, nomeada por constante desta prova; so PG efemero. */
/**
 * Prova VIVA das consultas 158a/158b (cancelar pedido de retirada pronta: o corpo privado de pedido__mudar_status), com a
 * migration 20261405600000 real. Mesmo molde do portao 56 (conferencia-de-banco-comum.cjs): a base nasce do zero com SO as
 * migrations anteriores; a 158b (antes) fica POSITIVA e a 158a reprova SO o corpo; aplica a 20261405600000 e a 158a fica
 * POSITIVA nas 3 linhas, enquanto a 158b reprova SO o corpo.
 *
 * A 158a tem uma clausula que olha OUTRA funcao: o corpo "esperado" tambem e' aceito quando a 20261405700000 (o cancelamento
 * do painel) ja foi aplicada por cima, e ai ela exige que o corpo de pedido__mudar_status_com_etapa seja o conhecido. A prova
 * cobre os dois estados vivos (so a 405600000; a 405600000 + a 405700000) e planta o estrago que so o segundo mostra
 * (a funcao da etapa com outro texto, ou ausente).
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`: corpo com outro texto, sobrecarga,
 * SECURITY INVOKER, STABLE/IMMUTABLE, STRICT, search_path trocado/sem fixo/com configuracao a mais, EXECUTE para anon,
 * authenticated, service_role ou PUBLIC (direto ou herdado), funcao apagada. O estrago "dono trocado" e' plantado tambem: a
 * consulta NAO o ve (ver o rotulo "ACHADO").
 *
 * Dado que ja existia: um pedido gravado antes da migration fica byte a byte depois dela, da 405700000 e de reaplicar.
 * Reaplicar e idempotente: a 158a segue POSITIVA.
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma. O comportamento (retirada pronta cancelada repoe o
 * estoque e segue o estorno) e' da prova viva da propria migration; aqui se prova a CONSULTA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/cancelar-retirada-pronta-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");
const { estragosDeFuncao } = require("./conferencia-de-funcao-estragos.cjs");

const A = "158a-conferir-cancelar-retirada-pronta-aplicado";
const B = "158b-antes-cancelar-retirada-pronta-base-vigente";
const ARQUIVO = "20261405600000_cancelar_retirada_pronta.sql";
const SEGUINTE = "20261405700000_cancelar_pedido_do_painel_confere_a_etapa.sql";
const FN = "public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)";
const ETAPA =
  "public.pedido__mudar_status_com_etapa(uuid,text,text,uuid,boolean,boolean,text)";
const U_CLI = "d1580000-0000-4000-8000-000000000001";
const PEDIDO = "d1580000-0000-4000-8000-000000000002";

const { rodarProva } = criarBancada({
  prefixo: "p158",
  arquivo: ARQUIVO,
  a: A,
  b: B,
  titulo: "Portao do cancelamento da retirada pronta (158a/158b)",
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
    corpo: item(A, "pedido__mudar_status: corpo exato"),
    attrs: item(A, "pedido__mudar_status: assinatura, atributos e ACL"),
  };
  for (const [k, v] of Object.entries(i)) {
    assert.equal(item(B, v.slice(0, 30)), v, `${k}: a 158b tem o mesmo rol`);
  }
  const SEGUINTE_SQL = fs.readFileSync(
    path.join(__dirname, "..", "..", "supabase", "migrations", SEGUINTE),
    "utf8",
  );

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: um pedido gravado ANTES da migration.
  await usar(antes, async (c) => {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, 'cliente@portao158.teste', '{}'::jsonb)",
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
       VALUES ($1,$2,'Fixture 158','{}',100,100,0,'delivered','online','online','pago',now(),now(),'ORD158',0)`,
      [PEDIDO, U_CLI],
    );
  });
  const linhaDoPedido = async (c) =>
    (
      await c.query("SELECT * FROM public.marketplace_orders WHERE id = $1", [
        PEDIDO,
      ])
    ).rows;

  // pedido__mudar_status e' interna: ninguem de fora (anon, authenticated, service_role, PUBLIC) a executa.
  const comuns = estragosDeFuncao({
    fn: FN,
    nome: "pedido__mudar_status",
    volatilidade: "v",
    trocarCorpo,
    corpo: [i.corpo],
    estrutura: [i.attrs],
    drop: [i.corpo, i.attrs],
    anon: [i.attrs],
    publico: [i.attrs],
    authSem: null,
    authCom: [i.attrs],
    servicoCom: [i.attrs],
    dono: [],
    prefixoPapel: "p158",
  });

  // ---------- ANTES: 158b positiva; 158a reprova so o corpo ----------
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
    "158b positiva (3 linhas) e 158a reprova SO o corpo na base criada com as migrations anteriores a 20261405600000",
  );

  // ---------- DEPOIS: so a 405600000 ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const antesDaMigration = await linhaDoPedido(c);
      assert.equal(antesDaMigration.length, 1, "o pedido ja existia");
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B, [i.corpo]);
      marcar(
        "158a: as 3 linhas ok=true apos aplicar a 20261405600000; 158b reprova SO o corpo",
      );
      assert.deepEqual(await linhaDoPedido(c), antesDaMigration);
      marcar(
        "dado que ja existia: o pedido fica byte a byte depois da migration (so o texto da funcao mudou)",
      );
      await c.query(MIGRATION);
      await consulta(c, A);
      assert.deepEqual(await linhaDoPedido(c), antesDaMigration);
      marcar(
        "reaplicar a 20261405600000 deixa a 158a positiva e o pedido intacto (idempotente)",
      );
      for (const [rotulo, sql, itens] of comuns) {
        await sabotar(c, rotulo, A, sql, itens);
      }

      // ---------- DEPOIS da 405600000 + 405700000: o corpo de pedido__mudar_status vira o da porta com etapa ----------
      await c.query(SEGUINTE_SQL);
      await consulta(c, A);
      await consulta(c, B, [i.corpo]);
      assert.deepEqual(await linhaDoPedido(c), antesDaMigration);
      marcar(
        "158a segue POSITIVA depois que a 20261405700000 (cancelamento do painel) troca o corpo de pedido__mudar_status por cima; 158b reprova SO o corpo; o pedido segue intacto",
      );
      // A clausula que so existe neste estado: o corpo novo so vale se a funcao da etapa tem o corpo conhecido.
      await sabotar(
        c,
        "pedido__mudar_status_com_etapa com outro texto (so a 158a, com a 405700000 por cima, enxerga)",
        A,
        (cc) => trocarCorpo(cc, ETAPA),
        [i.corpo],
      );
      await sabotar(
        c,
        "pedido__mudar_status_com_etapa apagada",
        A,
        `DROP FUNCTION ${ETAPA}`,
        [i.corpo],
      );
      await sabotar(
        c,
        "pedido__mudar_status (o delegador) com outro texto",
        A,
        (cc) => trocarCorpo(cc, FN),
        [i.corpo],
      );
      await sabotar(
        c,
        "pedido__mudar_status (o delegador) ganha EXECUTE de authenticated",
        A,
        `GRANT EXECUTE ON FUNCTION ${FN} TO authenticated`,
        [i.attrs],
      );
    }),
  );
});
