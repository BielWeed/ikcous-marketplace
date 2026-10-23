"use strict";

/**
 * A 20261384000000 (o pedido pago pelo app exige conta e não prende o estoque de visitante) redefine SÓ
 * create_marketplace_order_v24, em cima do corpo que a 20261350000000 deixou (UM bloco novo, o 0-ter: 'online' sem
 * sessão é recusado antes de reservar qualquer coisa).
 *
 * Toda prova viva que mede a 20261350000000 (ou as anteriores a ela) ISOLADA (o hash do corpo, o rollback, reaplicar a
 * migration) tem de desfazer ANTES esta: ela é a mais nova, e o pré-voo do rollback da 350 recusa
 * (B1_BASELINE_DIVERGENT) com o corpo dela no ar. É o comportamento CERTO (nunca restaurar por baixo de uma
 * redefinição posterior). a-compra-online-trava-posterior.cjs chama este módulo primeiro, então as provas históricas
 * da 229/236/244 e da 350 não precisam saber dele.
 *
 * Só nos clones efêmeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback não muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho é montado de literais deste arquivo (a migration do repositório). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME =
  "20261384000000_o_pedido_pelo_app_exige_conta_e_nao_prende_estoque_de_visitante.sql";
const HASH_V24_DESTA = "f8d6ed0c3622ab41123bacb98911a98f";
const HASH_V24_DA_350 = "e3c124d25632aaa9bcf1995153bc5a7e";

const V24 =
  "public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";

const PEDIDO_PELO_APP_EXIGE_CONTA = Object.freeze({
  nome: NOME,
  noAr: `SELECT COALESCE((
    SELECT md5(replace(prosrc, chr(13), ''))
      FROM pg_proc WHERE oid = to_regprocedure('${V24}')
  ) = '${HASH_V24_DESTA}', false) AS sim`,
});

/** Desfaz a 20261384000000 na transação aberta, se no ar; repetir é no-op. Devolve true se desfez. */
async function desfazerPedidoPeloAppExigeContaNaTransacao(cliente) {
  const r = await cliente.query(PEDIDO_PELO_APP_EXIGE_CONTA.noAr);
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
      `SELECT md5(replace(prosrc, chr(13), '')) AS v24 FROM pg_proc WHERE oid = to_regprocedure('${V24}')`,
    )
  ).rows[0];
  assert.equal(
    h.v24,
    HASH_V24_DA_350,
    "a 20261384000000 não restaurou create_marketplace_order_v24 ao corpo da 20261350000000; revise as sucessoras",
  );
  return true;
}

module.exports = {
  PEDIDO_PELO_APP_EXIGE_CONTA,
  desfazerPedidoPeloAppExigeContaNaTransacao,
};
