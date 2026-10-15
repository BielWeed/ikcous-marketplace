"use strict";

/**
 * A migration 20261243000000 (desfazer o recebimento recusa pedido com devolução; 15/10/2026) REDEFINE UM corpo de
 * migration anterior: public.registrar_pagamento_recebido(uuid, boolean), o que a 20261197000000 deixou (e que a
 * 20261195000000 e a própria 97 conferem por hash).
 *
 * Toda prova viva que DESFAZ, dentro da transação, uma migration que deixou esse corpo (o rollback da 95 ou da 97) ou
 * que REAPLICA a 97 por cima de si mesma tem de desfazer ANTES esta — o pré-voo de cada rollback mais velho recusa
 * (B1_BASELINE_DIVERGENT) com o corpo dela no ar, e o pré-voo da 97 só aceita o corpo da 95 ou o da 97. É o comportamento
 * CERTO (nunca restaurar por baixo de uma redefinição posterior); este módulo é a entrada única para as listas de
 * "posteriores" dessas provas, no formato { nome, noAr } que elas já usam (o mesmo molde de
 * reembolso-em-duvida-posterior.cjs).
 *
 * O rollback dela só troca o corpo de UMA função e não apaga dado: seguro dentro de qualquer transação de prova.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho é montado de literais deste arquivo (a migration do repositório). */

const fs = require("node:fs");
const path = require("node:path");

const DESFAZER_RECEBIMENTO = Object.freeze({
  nome: "20261243000000_desfazer_recebimento_recusa_com_devolucao.sql",
  // "No ar" = o corpo vivo tem a frase da recusa (só o corpo desta migration a tem).
  noAr: `SELECT prosrc LIKE '%Este pedido tem devolução: conclua, recuse ou cancele a devolução%' AS sim
           FROM pg_proc WHERE oid = to_regprocedure('public.registrar_pagamento_recebido(uuid,boolean)')`,
});

/** Desfaz a 20261243000000 na transação aberta do cliente, se ela estiver no ar. Devolve true se desfez. */
async function desfazerDesfazerRecebimentoNaTransacao(cliente) {
  const r = await cliente.query(DESFAZER_RECEBIMENTO.noAr);
  if (!r.rows[0] || r.rows[0].sim !== true) return false;
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "supabase",
      "migrations",
      `rollback-manual-${DESFAZER_RECEBIMENTO.nome}`,
    ),
    "utf8",
  );
  await cliente.query(sql);
  return true;
}

module.exports = {
  DESFAZER_RECEBIMENTO,
  desfazerDesfazerRecebimentoNaTransacao,
};
