"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os arquivos lidos sao migrations do repositorio, nomeadas por constantes desta prova; so PG efemero. */
/**
 * Prova VIVA das consultas 144a/144b (o item que a lojista marcou "Nao veio" pode ser devolvido de novo: o corpo novo de
 * devolucao_elegibilidade, solicitar_devolucao e devolucao_detalhe), com a migration 20261399992000 real. Mesmo molde do
 * portao 56 (conferencia-de-banco-comum.cjs): a base nasce do zero com SO as migrations anteriores; a 144b (antes) fica POSITIVA
 * nas 5 linhas e a 144a reprova SO os tres corpos; aplica a 20261399992000 e a 144a fica POSITIVA, enquanto a 144b reprova SO
 * os tres corpos.
 *
 * A 144a aceita tambem o corpo das duas SUCESSORAS: solicitar_devolucao da 20261405400000 (o centavo do cupom) e
 * devolucao_detalhe da 20261404000000 (a observacao da inspecao). A prova aplica as duas por cima e confere que a 144a segue
 * POSITIVA (e a 144b reprova os tres corpos), e que o corpo de uma sucessora com o texto trocado volta a reprovar so a linha dela.
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`, nas TRES funcoes: corpo com outro
 * texto, sobrecarga, SECURITY INVOKER, STABLE/VOLATILE/IMMUTABLE, STRICT, search_path trocado/sem fixo/com configuracao a mais
 * (a linha "as tres": atributos e ACL), EXECUTE para anon ou PUBLIC (direto ou herdado), authenticated sem EXECUTE, funcao
 * apagada. O estrago "dono trocado" e' plantado tambem: a consulta NAO o ve (ver o rotulo "ACHADO").
 *
 * Dado que ja existia: uma devolucao concluida gravada antes da migration fica byte a byte depois dela, das sucessoras e de
 * reaplicar. Reaplicar e idempotente: a 144a segue POSITIVA.
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma. O comportamento (o item ausente deixa de contar como ja
 * devolvido) e' do teste da propria migration; aqui se prova a CONSULTA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-item-que-nao-veio-pode-ser-devolvido-de-novo-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");
const { estragosDeFuncao } = require("./conferencia-de-funcao-estragos.cjs");

const A =
  "144a-conferir-o-item-que-nao-veio-pode-ser-devolvido-de-novo-aplicado";
const B =
  "144b-antes-o-item-que-nao-veio-pode-ser-devolvido-de-novo-base-vigente";
const ARQUIVO =
  "20261399992000_o_item_que_nao_veio_pode_ser_devolvido_de_novo.sql";
const SUCESSORA_DETALHE =
  "20261404000000_a_observacao_da_inspecao_so_a_loja_ve.sql";
const SUCESSORA_SOLICITAR =
  "20261405400000_a_devolucao_integral_nao_perde_o_centavo_do_cupom.sql";
const ELEGIBILIDADE = "public.devolucao_elegibilidade(uuid)";
const SOLICITAR =
  "public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])";
const DETALHE = "public.devolucao_detalhe(uuid)";
const U_CLI = "d1440000-0000-4000-8000-000000000001";
const PEDIDO = "d1440000-0000-4000-8000-000000000002";
const DEV = "d1440000-0000-4000-8000-000000000003";

const { rodarProva } = criarBancada({
  prefixo: "p144",
  arquivo: ARQUIVO,
  a: A,
  b: B,
  titulo: "Portao do item que nao veio pode ser devolvido de novo (144a/144b)",
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
    el: item(A, "devolucao_elegibilidade: corpo exato"),
    so: item(A, "solicitar_devolucao: corpo exato"),
    de: item(A, "devolucao_detalhe: corpo exato"),
    tres: item(A, "as tres: uma so de cada nome"),
  };
  for (const [k, v] of Object.entries(i)) {
    assert.equal(item(B, v.slice(0, 30)), v, `${k}: a 144b tem o mesmo rol`);
  }
  const CORPOS = [i.el, i.so, i.de];
  const lerMigration = (nome) =>
    fs.readFileSync(
      path.join(__dirname, "..", "..", "supabase", "migrations", nome),
      "utf8",
    );

  const antes = await montarBase();
  // DADO QUE JA EXISTIA: uma devolucao concluida gravada ANTES da migration.
  await usar(antes, async (c) => {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, 'cliente@portao144.teste', '{}'::jsonb)",
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
       VALUES ($1,$2,'Fixture 144','{}',100,100,0,'delivered','online','online','pago',now(),now(),'ORD144',0)`,
      [PEDIDO, U_CLI],
    );
    await c.query(
      `INSERT INTO public.devolucoes
         (id,protocolo,order_id,user_id,tipo,motivo,resolucao_desejada,resolucao_final,modalidade,metodo_retorno,status,valor_itens,
          valor_frete_ida,prazo_ate,politica,concluida_em,mensagem_loja)
       VALUES ($1,'DEV144',$2,$3,'arrependimento','outro','reembolso','reembolso','nacional','envio_proprio','concluida',40,0,
               current_date+7,'{}',now(),'mensagem da loja')`,
      [DEV, PEDIDO, U_CLI],
    );
  });
  const dados = async (c) => ({
    pedido: (
      await c.query("SELECT * FROM public.marketplace_orders WHERE id = $1", [
        PEDIDO,
      ])
    ).rows,
    devolucao: (
      await c.query("SELECT * FROM public.devolucoes WHERE id = $1", [DEV])
    ).rows,
  });

  // As tres funcoes: EXECUTE so de authenticated (nem PUBLIC nem anon); atributos e ACL dividem UMA linha ("as tres").
  const dasTres = [
    [ELEGIBILIDADE, "devolucao_elegibilidade", "s", i.el, "p144a"],
    [SOLICITAR, "solicitar_devolucao", "v", i.so, "p144b"],
    [DETALHE, "devolucao_detalhe", "s", i.de, "p144c"],
  ].flatMap(([fn, nome, vol, corpo, papel]) =>
    estragosDeFuncao({
      fn,
      nome,
      volatilidade: vol,
      trocarCorpo,
      corpo: [corpo],
      estrutura: [i.tres],
      drop: [corpo, i.tres],
      anon: [i.tres],
      publico: [i.tres],
      authSem: [i.tres],
      authCom: null,
      servicoCom: null,
      dono: [],
      prefixoPapel: papel,
    }),
  );

  // ---------- ANTES: 144b positiva; 144a reprova os tres corpos ----------
  await usar(antes, (c) =>
    emTransacao(c, async () => {
      await consulta(c, B);
      await consulta(c, A, CORPOS);
      for (const [rotulo, sql, itens] of dasTres) {
        await sabotar(c, rotulo, B, sql, itens);
      }
    }),
  );
  marcar(
    "144b positiva (5 linhas) e 144a reprova SO os tres corpos na base criada com as migrations anteriores a 20261399992000",
  );

  // ---------- DEPOIS ----------
  const depois = await criar("depois", antes);
  await usar(depois, (c) =>
    emTransacao(c, async () => {
      const antesDaMigration = await dados(c);
      assert.equal(
        antesDaMigration.devolucao.length,
        1,
        "a devolucao ja existia",
      );
      await c.query(MIGRATION);
      await consulta(c, A);
      await consulta(c, B, CORPOS);
      marcar(
        "144a: as 5 linhas ok=true apos aplicar a 20261399992000; 144b reprova SO os tres corpos",
      );
      assert.deepEqual(await dados(c), antesDaMigration);
      marcar(
        "dado que ja existia: o pedido e a devolucao concluida ficam byte a byte depois da migration (so o texto das funcoes mudou)",
      );
      await c.query(MIGRATION);
      await consulta(c, A);
      assert.deepEqual(await dados(c), antesDaMigration);
      marcar(
        "reaplicar a 20261399992000 deixa a 144a positiva e os dados intactos (idempotente)",
      );
      for (const [rotulo, sql, itens] of dasTres) {
        await sabotar(c, rotulo, A, sql, itens);
      }

      // ---------- as duas sucessoras, por cima ----------
      await c.query(lerMigration(SUCESSORA_DETALHE));
      await consulta(c, A);
      await consulta(c, B, CORPOS);
      marcar(
        "144a segue POSITIVA com a sucessora 20261404000000 (devolucao_detalhe) por cima",
      );
      await c.query(lerMigration(SUCESSORA_SOLICITAR));
      await consulta(c, A);
      await consulta(c, B, CORPOS);
      assert.deepEqual(await dados(c), antesDaMigration);
      marcar(
        "144a segue POSITIVA com as duas sucessoras (20261404000000 e 20261405400000) por cima; 144b reprova os tres corpos; dados intactos",
      );
      await sabotar(
        c,
        "devolucao_detalhe da sucessora com outro texto",
        A,
        (cc) => trocarCorpo(cc, DETALHE),
        [i.de],
      );
      await sabotar(
        c,
        "solicitar_devolucao da sucessora com outro texto",
        A,
        (cc) => trocarCorpo(cc, SOLICITAR),
        [i.so],
      );
      await sabotar(
        c,
        "devolucao_elegibilidade com outro texto (nao tem sucessora)",
        A,
        (cc) => trocarCorpo(cc, ELEGIBILIDADE),
        [i.el],
      );
    }),
  );
});
