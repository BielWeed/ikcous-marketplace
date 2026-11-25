"use strict";
/**
 * Prova VIVA das consultas 157a/157b (a devolucao integral nao perde o centavo do cupom: solicitar_devolucao com o corpo novo),
 * com a migration 20261405400000 real. Mesmo molde do portao 56 (conferencia-de-banco-comum.cjs): a base nasce do zero com SO
 * as migrations anteriores; a 157b (antes) fica POSITIVA e a 157a reprova SO o corpo; aplica a 20261405400000 e a 157a fica
 * POSITIVA nas 3 linhas, enquanto a 157b reprova SO o corpo.
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`: corpo com outro texto, sobrecarga,
 * SECURITY INVOKER, STABLE/IMMUTABLE, STRICT, search_path trocado/sem fixo/com configuracao a mais, EXECUTE para anon ou PUBLIC
 * (direto ou herdado), authenticated sem EXECUTE, funcao apagada. Os estragos "dono trocado" e "service_role ganha EXECUTE"
 * sao plantados tambem: a consulta NAO olha nenhum dos dois (ver o rotulo "ACHADO").
 *
 * Dado que ja existia: uma devolucao CONCLUIDA (com o valor dos itens ja gravado) antes da migration fica byte a byte depois
 * dela e depois de reaplicar (a migration troca so o texto da funcao; nenhuma devolucao antiga e reescrita). Reaplicar e
 * idempotente: a 157a segue POSITIVA.
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma. O arredondamento do cupom (49,33 / 49,34 / 49,33) e'
 * da prova de comportamento da propria migration; aqui se prova a CONSULTA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-devolucao-integral-nao-perde-o-centavo-do-cupom-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");
const { estragosDeFuncao } = require("./conferencia-de-funcao-estragos.cjs");

const A =
  "157a-conferir-a-devolucao-integral-nao-perde-o-centavo-do-cupom-aplicado";
const B =
  "157b-antes-a-devolucao-integral-nao-perde-o-centavo-do-cupom-base-vigente";
const ARQUIVO =
  "20261405400000_a_devolucao_integral_nao_perde_o_centavo_do_cupom.sql";
const FN = "public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])";
const U_CLI = "d1570000-0000-4000-8000-000000000001";
const PEDIDO = "d1570000-0000-4000-8000-000000000002";
const DEV = "d1570000-0000-4000-8000-000000000003";

const { rodarProva } = criarBancada({
  prefixo: "p157",
  arquivo: ARQUIVO,
  a: A,
  b: B,
  titulo:
    "Portao da devolucao integral sem perder o centavo do cupom (157a/157b)",
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
    corpo: item(A, "solicitar_devolucao: corpo exato"),
    attrs: item(A, "solicitar_devolucao: uma so"),
  };
  for (const [k, v] of Object.entries(i)) {
    assert.equal(item(B, v.slice(0, 30)), v, `${k}: a 157b tem o mesmo rol`);
  }

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: uma devolucao concluida, com o valor dos itens gravado pelo corpo antigo, ANTES da migration.
  await usar(antes, async (c) => {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, 'cliente@portao157.teste', '{}'::jsonb)",
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
       VALUES ($1,$2,'Fixture 157','{}',148,150,0,'delivered','online','online','pago',now(),now(),'ORD157',0)`,
      [PEDIDO, U_CLI],
    );
    await c.query(
      `INSERT INTO public.devolucoes
         (id,protocolo,order_id,user_id,tipo,motivo,resolucao_desejada,resolucao_final,modalidade,metodo_retorno,status,valor_itens,
          valor_frete_ida,prazo_ate,politica,concluida_em,mensagem_loja)
       VALUES ($1,'DEV157',$2,$3,'arrependimento','outro','reembolso','reembolso','nacional','envio_proprio','concluida',147.99,0,
               current_date+7,'{}',now(),'mensagem da loja')`,
      [DEV, PEDIDO, U_CLI],
    );
  });
  const linhaDaDevolucao = async (c) =>
    (await c.query("SELECT * FROM public.devolucoes WHERE id = $1", [DEV]))
      .rows;

  // Estragos que valem nos dois estados (o rol e' o mesmo; muda so o esperado do corpo).
  const comuns = estragosDeFuncao({
    fn: FN,
    nome: "solicitar_devolucao",
    volatilidade: "v",
    trocarCorpo,
    corpo: [i.corpo],
    estrutura: [i.attrs],
    drop: [i.corpo, i.attrs],
    anon: [i.attrs],
    publico: [i.attrs],
    authSem: [i.attrs],
    authCom: null,
    servicoCom: null,
    dono: [],
    prefixoPapel: "p157",
  });
  // A 157 so exige o EXECUTE de authenticated e a ausencia de anon/PUBLIC: o service_role ganhar a porta nao e' defeito dela.
  comuns.push([
    "service_role ganha EXECUTE (a consulta nao o proibe: o rol so fala de authenticated, anon e PUBLIC)",
    `GRANT EXECUTE ON FUNCTION ${FN} TO service_role`,
    [],
  ]);

  // ---------- ANTES: 157b positiva; 157a reprova so o corpo ----------
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
    "157b positiva (3 linhas) e 157a reprova SO o corpo na base criada com as migrations anteriores a 20261405400000",
  );

  // ---------- DEPOIS ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const antesDaMigration = await linhaDaDevolucao(c);
      assert.equal(antesDaMigration.length, 1, "a devolucao ja existia");
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B, [i.corpo]);
      marcar(
        "157a: as 3 linhas ok=true apos aplicar a 20261405400000; 157b reprova SO o corpo",
      );
      // Dado que ja existia: a devolucao concluida (e o valor gravado) ficam byte a byte; a migration so trocou o texto da funcao.
      assert.deepEqual(await linhaDaDevolucao(c), antesDaMigration);
      marcar(
        "dado que ja existia: a devolucao concluida e o valor dos itens ficam intactos depois da migration",
      );
      await c.query(MIGRATION);
      await consulta(c, A);
      assert.deepEqual(await linhaDaDevolucao(c), antesDaMigration);
      marcar(
        "reaplicar a 20261405400000 deixa a 157a positiva e a devolucao intacta (idempotente)",
      );
      for (const [rotulo, sql, itens] of comuns) {
        await sabotar(c, rotulo, A, sql, itens);
      }
    }),
  );
});
