"use strict";

/**
 * A 20261399920000 (o sino do pedido vencido fala do vencimento) redefine notifica_cliente_de_mudanca_de_status em cima do corpo da
 * 20261233000000: o mesmo corpo com o ramo `cancelled` separando o pedido vencido (payment_status 'expirado') do cancelamento comum.
 *
 * Toda prova viva que mede a 20261233000000 sobre a arvore ja migrada (o-sino-do-pedido-de-retirada-viva.cjs e o portao dela) tem de desfazer
 * ANTES esta: o rollback-manual da 20261233000000 e o pre-voo dela recusam (B1_BASELINE_DIVERGENT) com um corpo posterior no ar. E' o
 * comportamento CERTO (nunca restaurar por baixo de uma redefinicao posterior).
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback nao muda dado, assinatura, trigger nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (a migration do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261399920000_o_sino_do_pedido_vencido_fala_do_vencimento.sql";
const HASH_DESTA = "dd76f4442bcb0a3b05bcede6d80fc406";
const HASH_DA_233 = "fc8fd54a2fa1533f0d926744aab8ff58";
const ASSINATURA = "public.notifica_cliente_de_mudanca_de_status()";

const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${ASSINATURA}')`;

const SINO_DO_PEDIDO_VENCIDO = Object.freeze({
  nome: NOME,
  hashDesta: HASH_DESTA,
});

/** Desfaz a 20261399920000 na conexao/transacao do chamador, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerSinoDoPedidoVencidoNaTransacao(cliente) {
  const r = await cliente.query(hashVivo);
  if (r.rows[0]?.h !== HASH_DESTA) return false;
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
  assert.equal(
    (await cliente.query(hashVivo)).rows[0]?.h,
    HASH_DA_233,
    "a 20261399920000 nao restaurou notifica_cliente_de_mudanca_de_status ao corpo da 20261233000000; revise as sucessoras",
  );
  return true;
}

module.exports = {
  SINO_DO_PEDIDO_VENCIDO,
  desfazerSinoDoPedidoVencidoNaTransacao,
};
