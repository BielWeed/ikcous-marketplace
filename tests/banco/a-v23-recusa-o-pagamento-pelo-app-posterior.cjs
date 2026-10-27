"use strict";

/**
 * A 20261394200000 (a v23 recusa o pagamento pelo app) redefine SO create_marketplace_order_v23, em cima do corpo que a
 * 20261394000000 deixou (UM trecho novo, o 0-ter: p_payment_method 'online' e' recusado para todo mundo, antes de reservar
 * qualquer coisa).
 *
 * Toda prova viva que mede a 20261394000000 (ou as anteriores a ela) ISOLADA (o hash do corpo, o rollback, reaplicar a
 * migration) tem de desfazer ANTES esta: ela e' a mais nova, e o pre-voo do rollback da 394000 recusa (B1_BASELINE_DIVERGENT)
 * com o corpo dela no ar. E' o comportamento CERTO (nunca restaurar por baixo de uma redefinicao posterior).
 * o-pedido-de-visitante-na-entrega-posterior.cjs chama este modulo primeiro, entao as provas historicas da 229/236/244, da
 * 350, da 384 e da 394000 nao precisam saber dele.
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback nao muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (a migration do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261394200000_a_v23_recusa_o_pagamento_pelo_app.sql";
const HASH_V23_DESTA = "86a30fe3502bbafd1a507ce03189bc2d";
const HASH_V23_DA_394 = "89c99662346d47a4d6b3d13612ca4acb";

const V23 =
  "public.create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";

const V23_RECUSA_O_PAGAMENTO_PELO_APP = Object.freeze({
  nome: NOME,
  noAr: `SELECT COALESCE((
    SELECT md5(replace(prosrc, chr(13), ''))
      FROM pg_proc WHERE oid = to_regprocedure('${V23}')
  ) = '${HASH_V23_DESTA}', false) AS sim`,
});

/** Desfaz a 20261394200000 na transacao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerV23RecusaOPagamentoPeloAppNaTransacao(cliente) {
  const r = await cliente.query(V23_RECUSA_O_PAGAMENTO_PELO_APP.noAr);
  if (r.rows[0]?.sim !== true) return false;
  await cliente.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${NOME}`,
      ),
      "utf8",
    ),
  );
  const h = (
    await cliente.query(
      `SELECT md5(replace(prosrc, chr(13), '')) AS v23 FROM pg_proc WHERE oid = to_regprocedure('${V23}')`,
    )
  ).rows[0];
  assert.equal(
    h.v23,
    HASH_V23_DA_394,
    "a 20261394200000 não restaurou create_marketplace_order_v23 ao corpo da 20261394000000; revise as sucessoras",
  );
  return true;
}

module.exports = {
  V23_RECUSA_O_PAGAMENTO_PELO_APP,
  desfazerV23RecusaOPagamentoPeloAppNaTransacao,
};
