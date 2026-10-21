"use strict";

/**
 * A 20261349000000 redefine pagamentos_a_reconciliar (o pedido ENTREGUE antes da confirmação do PIX entra na
 * fila de reconciliação) em cima do corpo que a 20261270000000 deixou.
 *
 * Toda prova viva que mede a 20261270000000 ISOLADA (o rollback dela, a consulta 57a/57b) tem de desfazer ANTES esta:
 * ela é a mais nova, e o pré-voo do rollback da 270 recusa (B1_BASELINE_DIVERGENT) com o corpo dela no ar. É o
 * comportamento CERTO (nunca restaurar por baixo de uma redefinição posterior). Este módulo é a entrada única, no
 * formato { nome, noAr } das outras listas de "posteriores"; pagamento-adiantado-posterior.cjs o chama primeiro, então
 * as provas históricas da 226/241 não precisam saber dele.
 *
 * Só nos clones efêmeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback não muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho é montado de literais deste arquivo (a migration do repositório). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME =
  "20261349000000_o_pedido_entregue_antes_da_confirmacao_entra_na_reconciliacao.sql";
const HASH_DESTA = "350e732dbae6ba45bede77c08e0db6d8";
const HASH_DA_270 = "aed09ec910825168a3217b2e308824c5";

const HASH_FILA = `SELECT md5(replace(prosrc, chr(13), '')) AS hash
  FROM pg_proc WHERE oid = to_regprocedure('public.pagamentos_a_reconciliar()')`;

const RECONCILIACAO_DO_ENTREGUE = Object.freeze({
  nome: NOME,
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.pagamentos_a_reconciliar()'))
    = '${HASH_DESTA}', false) AS sim`,
});

/** Desfaz a 20261349000000 na transação aberta, se no ar; repetir é no-op. Devolve true se desfez. */
async function desfazerReconciliacaoDoEntregueNaTransacao(cliente) {
  const r = await cliente.query(RECONCILIACAO_DO_ENTREGUE.noAr);
  if (r.rows[0]?.sim !== true) return false;
  await cliente.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../supabase/migrations",
        `rollback-manual-${NOME}`,
      ),
      "utf8",
    ),
  );
  const restaurado = await cliente.query(HASH_FILA);
  assert.equal(
    restaurado.rows[0]?.hash,
    HASH_DA_270,
    "a 20261349000000 não restaurou pagamentos_a_reconciliar ao corpo da 20261270000000; revise as sucessoras",
  );
  return true;
}

module.exports = {
  RECONCILIACAO_DO_ENTREGUE,
  desfazerReconciliacaoDoEntregueNaTransacao,
};
