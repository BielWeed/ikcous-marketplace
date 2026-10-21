"use strict";

/**
 * A 20261350000000 (a compra online trava o preço e espera a mesma chave) redefine create_marketplace_order_v23 e
 * create_marketplace_order_v24 em cima dos corpos que a 20261244000000 deixou (só três edições: FOR NO KEY UPDATE OF v, p;
 * o advisory lock da chave de idempotência; e as travas do carrinho em ordem global, variações e depois produtos por id).
 *
 * Toda prova viva que mede a 20261244000000 ISOLADA (o hash dos corpos dela, o rollback dela, reaplicá-la) tem de
 * desfazer ANTES esta: ela é a mais nova, e o pré-voo do rollback da 244 recusa (B1_BASELINE_DIVERGENT) com o corpo dela
 * no ar. É o comportamento CERTO (nunca restaurar por baixo de uma redefinição posterior). Este módulo é a entrada única,
 * no formato { nome, noAr } das outras listas de "posteriores"; a-loja-escolhe-como-entrega-posterior.cjs o chama
 * primeiro, então as provas históricas da 229/236/244 não precisam saber dele.
 *
 * Só nos clones efêmeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback não muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho é montado de literais deste arquivo (a migration do repositório). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME =
  "20261350000000_a_compra_online_trava_o_preco_e_espera_a_mesma_chave.sql";
const HASH_V23_DESTA = "6b71cb823967518955407b532904ae91";
const HASH_V24_DESTA = "e3c124d25632aaa9bcf1995153bc5a7e";
const HASH_V23_DA_244 = "79445d64a87843be2d42bf601c7090ec";
const HASH_V24_DA_244 = "85c37af4baa2f5ce1375bdd9e943c746";

const HASHES = `SELECT
  md5(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)')), chr(13), '')) AS v23,
  md5(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)')), chr(13), '')) AS v24`;

const COMPRA_ONLINE_TRAVA = Object.freeze({
  nome: NOME,
  // "No ar" = as DUAS funções com o corpo desta migration (as duas caem e sobem juntas, num rollback só).
  noAr: `SELECT COALESCE((
    SELECT md5(replace(prosrc, chr(13), ''))
      FROM pg_proc WHERE oid = to_regprocedure('public.create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)')
  ) = '${HASH_V23_DESTA}', false) AND COALESCE((
    SELECT md5(replace(prosrc, chr(13), ''))
      FROM pg_proc WHERE oid = to_regprocedure('public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)')
  ) = '${HASH_V24_DESTA}', false) AS sim`,
});

/** Desfaz a 20261350000000 na transação aberta, se no ar; repetir é no-op. Devolve true se desfez. */
async function desfazerCompraOnlineTravaNaTransacao(cliente) {
  const r = await cliente.query(COMPRA_ONLINE_TRAVA.noAr);
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
  const h = (await cliente.query(HASHES)).rows[0];
  assert.equal(
    h.v23,
    HASH_V23_DA_244,
    "a 20261350000000 não restaurou create_marketplace_order_v23 ao corpo da 20261244000000; revise as sucessoras",
  );
  assert.equal(
    h.v24,
    HASH_V24_DA_244,
    "a 20261350000000 não restaurou create_marketplace_order_v24 ao corpo da 20261244000000; revise as sucessoras",
  );
  return true;
}

module.exports = {
  COMPRA_ONLINE_TRAVA,
  desfazerCompraOnlineTravaNaTransacao,
};
