"use strict";

/**
 * A migration 20261241000000 (o reembolso em dúvida prende o saldo; lote R1 do plano reembolso-ab, 15/10/2026)
 * REDEFINE sete corpos de migrations anteriores: pedido__saldo_a_estornar (1198), solicitar_estorno (1201),
 * admin_devolucao_concluir (1225), autorizar_post_do_estorno (1196), reemitir_reembolso_da_devolucao e
 * admin_devolucao_reembolso_por_fora (1226) e devolucao_avisa_o_cliente (1225), e FECHA o EXECUTE do logado
 * em admin_devolucao_reemitir_reembolso (a porta antiga que dobrava o reembolso).
 *
 * Toda prova viva que DESFAZ, dentro da transação, uma migration que deixou um desses corpos (o rollback da
 * 1196, 1198, 1201, 1225, 1226, ou a cadeia até a 97) tem de desfazer ANTES esta — ela é a mais nova, e o
 * pré-voo de cada rollback mais velho recusa (B1_BASELINE_DIVERGENT) com o corpo dela no ar. É o comportamento
 * CERTO (nunca restaurar por baixo de uma redefinição posterior); este módulo é a entrada única para as listas
 * de "posteriores" dessas provas, no formato { nome, noAr } que elas já usam.
 *
 * O rollback dela recusa se houver marca em order_refund_prova (MARCA_DE_REEMBOLSO_NAO_SE_APAGA_SEM_QUERER):
 * num banco de prova recém-migrado a tabela está vazia.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho é montado de literais deste arquivo (a migration do repositório). */

const fs = require("node:fs");
const path = require("node:path");

const REEMBOLSO_EM_DUVIDA = Object.freeze({
  nome: "20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql",
  noAr: "SELECT to_regprocedure('public.order_refund__pode_ter_saido(uuid)') IS NOT NULL AS sim",
});

/** Desfaz a 20261241000000 na transação aberta do cliente, se ela estiver no ar. Devolve true se desfez. */
async function desfazerReembolsoEmDuvidaNaTransacao(cliente) {
  const r = await cliente.query(REEMBOLSO_EM_DUVIDA.noAr);
  if (!r.rows[0] || r.rows[0].sim !== true) return false;
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "supabase",
      "migrations",
      `rollback-manual-${REEMBOLSO_EM_DUVIDA.nome}`,
    ),
    "utf8",
  );
  await cliente.query(sql);
  return true;
}

module.exports = { REEMBOLSO_EM_DUVIDA, desfazerReembolsoEmDuvidaNaTransacao };
