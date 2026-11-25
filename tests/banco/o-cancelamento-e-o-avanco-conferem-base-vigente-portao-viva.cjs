"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os arquivos lidos sao migrations do repositorio, nomeadas por constantes desta prova; so PG efemero. */
/**
 * Prova VIVA da consulta 129b (ANTES do lote de cancelamento e avanco do pedido: a base vigente de avancar_status_do_pedido,
 * pedido__mudar_status e cancelar_pedido_com_cobranca, mais as ausencias e as colunas que o lote vai usar). Mesmo molde do
 * portao 56 (conferencia-de-banco-comum.cjs), com UMA diferenca de natureza: a 129b NAO tem 129a nem migration propria (o lote
 * 129 nunca entrou no repositorio; o canais-de-backend.json diz que "nenhuma migration ou prova de pos-aplicacao e registrada").
 * O que ela mede e' a base DE ANTES da 20261405600000 (cancelar retirada pronta): o corpo de pedido__mudar_status que ela espera
 * (4623b27a...) e' o que a 20261405600000 troca. Por isso a bancada usa essa migration so como CORTE da base ("so as
 * migrations anteriores"); nao a aplica como "a migration da prova".
 *
 * (1) Base de antes: a 129b fica POSITIVA nas 18 linhas. (2) Depois da 20261405600000 e da 20261405700000 (ja no repositorio) a
 * 129b reprova o corpo de pedido__mudar_status e as AUSENCIAS (cancelar_pedido_na_etapa e cancelar_pedido_com_cobranca_na_etapa
 * continuam ausentes: nao viram `nao`): a consulta ficou VELHA em relacao ao repositorio; quem a rodar numa loja onde as duas
 * migrations ja entraram leva NEGATIVA e parou sem defeito algum. A prova trava essa medida.
 *
 * Depois, UM estrago por vez (cada um num savepoint) e SO a(s) linha(s) certa(s) vira `nao`, nas TRES funcoes: corpo com outro
 * texto, sobrecarga, SECURITY INVOKER, STABLE/IMMUTABLE, STRICT, search_path trocado/sem fixo/com configuracao a mais (linha da
 * assinatura e dos atributos), EXECUTE indevido (anon, PUBLIC, authenticated, service_role, herdado por papel) ou perdido (linha
 * da ACL), funcao apagada; is_admin_atual() apagada; cada funcao "na etapa" criada (a ausencia vira `nao`); cada uma das 5
 * colunas de marketplace_orders apagada. O estrago "dono trocado" e' plantado tambem: a consulta NAO o ve (ver o rotulo "ACHADO").
 *
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma; nao ha dado nem migration a reaplicar (so catalogo).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-cancelamento-e-o-avanco-conferem-base-vigente-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { criarBancada } = require("./conferencia-de-banco-comum.cjs");
const { estragosDeFuncao } = require("./conferencia-de-funcao-estragos.cjs");

const B = "129b-antes-o-cancelamento-e-o-avanco-conferem-base-vigente";
// So o CORTE da base: as migrations anteriores a esta. A 129b nao tem 129a: a mesma consulta ocupa os dois lugares.
const CORTE = "20261405600000_cancelar_retirada_pronta.sql";
const SEGUINTES = [
  "20261405600000_cancelar_retirada_pronta.sql",
  "20261405700000_cancelar_pedido_do_painel_confere_a_etapa.sql",
];
const AVANCAR = "public.avancar_status_do_pedido(uuid,text,text,text)";
const MUDAR =
  "public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)";
const COBRANCA =
  "public.cancelar_pedido_com_cobranca(uuid,uuid,text,text,text)";

const { rodarProva } = criarBancada({
  prefixo: "p129",
  arquivo: CORTE,
  a: B,
  b: B,
  titulo: "Portao da base de antes do cancelamento e avanco (129b)",
});

rodarProva(async (H) => {
  const {
    usar,
    montarBase,
    emTransacao,
    consulta,
    item,
    sabotar,
    trocarCorpo,
    marcar,
  } = H;
  const rol = (inicio) => item(B, inicio);
  const i = {
    avCorpo: rol("avancar_status_do_pedido: corpo exato"),
    avAttrs: rol("avancar_status_do_pedido: assinatura"),
    avAcl: rol("avancar_status_do_pedido: EXECUTE"),
    muCorpo: rol("pedido__mudar_status: corpo exato"),
    muAttrs: rol("pedido__mudar_status: assinatura"),
    muAcl: rol("pedido__mudar_status: sem EXECUTE"),
    coCorpo: rol("cancelar_pedido_com_cobranca: corpo exato"),
    coAttrs: rol("cancelar_pedido_com_cobranca: assinatura"),
    coAcl: rol("cancelar_pedido_com_cobranca: EXECUTE"),
    admin: rol("is_admin_atual(): existe"),
    semEtapa: rol("cancelar_pedido_na_etapa: ausente"),
    semCobEtapa: rol("cancelar_pedido_com_cobranca_na_etapa: ausente"),
  };
  const colunas = [
    "payment_status",
    "status",
    "user_id",
    "stock_returned_at",
    "estorno_manual_registrado_em",
  ].map((nome) => [nome, rol(`marketplace_orders.${nome}: coluna existe`)]);
  const lerMigration = (nome) =>
    fs.readFileSync(
      path.join(__dirname, "..", "..", "supabase", "migrations", nome),
      "utf8",
    );

  const antes = await montarBase();

  const doAvancar = estragosDeFuncao({
    fn: AVANCAR,
    nome: "avancar_status_do_pedido",
    volatilidade: "v",
    trocarCorpo,
    corpo: [i.avCorpo],
    estrutura: [i.avAttrs],
    drop: [i.avCorpo, i.avAttrs, i.avAcl],
    anon: [i.avAcl],
    publico: [i.avAcl],
    authSem: [i.avAcl],
    authCom: null,
    servicoCom: [i.avAcl],
    dono: [],
    prefixoPapel: "p129a",
  });
  const doMudar = estragosDeFuncao({
    fn: MUDAR,
    nome: "pedido__mudar_status",
    volatilidade: "v",
    trocarCorpo,
    corpo: [i.muCorpo],
    estrutura: [i.muAttrs],
    drop: [i.muCorpo, i.muAttrs, i.muAcl],
    anon: [i.muAcl],
    publico: [i.muAcl],
    authSem: null,
    authCom: [i.muAcl],
    servicoCom: [i.muAcl],
    dono: [],
    prefixoPapel: "p129b",
  });
  const daCobranca = estragosDeFuncao({
    fn: COBRANCA,
    nome: "cancelar_pedido_com_cobranca",
    volatilidade: "v",
    trocarCorpo,
    corpo: [i.coCorpo],
    estrutura: [i.coAttrs],
    drop: [i.coCorpo, i.coAttrs, i.coAcl],
    anon: [i.coAcl],
    publico: [i.coAcl],
    authSem: null,
    authCom: [i.coAcl],
    servicoCom: null,
    dono: [],
    prefixoPapel: "p129c",
  });
  // Herdar o service_role tem um efeito a mais: o authenticated passa a executar TAMBEM cancelar_pedido_com_cobranca (que o
  // service_role executa por regra), e a linha dela reprova junto.
  for (const par of doMudar) {
    if (par[0].startsWith("authenticated herda o service_role")) {
      par[2] = [i.muAcl, i.coAcl];
    }
  }
  // cancelar_pedido_com_cobranca e' so do servidor: perder o EXECUTE do service_role e' o estrago do lado dela.
  daCobranca.push([
    "service_role perde EXECUTE em cancelar_pedido_com_cobranca",
    `REVOKE EXECUTE ON FUNCTION ${COBRANCA} FROM service_role`,
    [i.coAcl],
  ]);

  await usar(antes, (c) =>
    emTransacao(c, async () => {
      // (1) A base de antes: positiva nas 18 linhas.
      const linhas = await consulta(c, B);
      assert.equal(linhas.length, 18);
      marcar(
        "129b positiva (18 linhas) na base criada com as migrations anteriores a 20261405600000",
      );

      for (const lista of [doAvancar, doMudar, daCobranca]) {
        for (const [rotulo, sql, itens] of lista) {
          await sabotar(c, rotulo, B, sql, itens);
        }
      }
      await sabotar(
        c,
        "is_admin_atual() apagada",
        B,
        "DROP FUNCTION public.is_admin_atual()",
        [i.admin],
      );
      await sabotar(
        c,
        "cancelar_pedido_na_etapa passa a existir (outra assinatura qualquer)",
        B,
        "CREATE FUNCTION public.cancelar_pedido_na_etapa(integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$",
        [i.semEtapa],
      );
      await sabotar(
        c,
        "cancelar_pedido_com_cobranca_na_etapa passa a existir (outra assinatura qualquer)",
        B,
        "CREATE FUNCTION public.cancelar_pedido_com_cobranca_na_etapa(integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$",
        [i.semCobEtapa],
      );
      for (const [nome, linha] of colunas) {
        await sabotar(
          c,
          `marketplace_orders.${nome} apagada`,
          B,
          `ALTER TABLE public.marketplace_orders DROP COLUMN ${nome} CASCADE`,
          [linha],
        );
      }
      await sabotar(
        c,
        "marketplace_orders sumida (as 5 colunas somem juntas)",
        B,
        "DROP TABLE public.marketplace_orders CASCADE",
        colunas.map(([, linha]) => linha),
      );

      // (2) A consulta fica VELHA quando as duas migrations seguintes entram: reprova o corpo de pedido__mudar_status.
      for (const nome of SEGUINTES) await c.query(lerMigration(nome));
      await consulta(c, B, [i.muCorpo]);
      marcar(
        "ACHADO: com a 20261405600000 e a 20261405700000 aplicadas (ja no repositorio) a 129b reprova SO o corpo de pedido__mudar_status; a consulta descreve uma base que ja nao e' a do repositorio",
      );
    }),
  );
});
