"use strict";

/**
 * A 20261394000000 (o pedido de visitante na entrega tem freio) redefine create_marketplace_order_v23 e
 * create_marketplace_order_v24 em cima dos corpos vigentes (a 20261350000000 na v23, a 20261384000000 na v24): o mesmo
 * corpo mais UM trecho novo, o 0-quater (teto de 10 unidades, teto de 10 pedidos de visitante pendentes por loja e a
 * recusa do p_address_id sem sessão).
 *
 * Toda prova viva que mede a 20261384000000 (ou as anteriores a ela) ISOLADA (o hash do corpo, o rollback, reaplicar a
 * migration) tem de desfazer ANTES esta: ela é a mais nova, e o pré-voo do rollback da 384 recusa
 * (B1_BASELINE_DIVERGENT) com o corpo dela no ar. É o comportamento CERTO (nunca restaurar por baixo de uma redefinição
 * posterior). pedido-pelo-app-exige-conta-posterior.cjs chama este módulo primeiro, então as provas históricas da
 * 229/236/244, da 350 e da 384 não precisam saber dele.
 *
 * Só nos clones efêmeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback não muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho é montado de literais deste arquivo (a migration do repositório). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261394000000_o_pedido_de_visitante_na_entrega_tem_freio.sql";
const HASH_V23_DESTA = "89c99662346d47a4d6b3d13612ca4acb";
const HASH_V24_DESTA = "36c80a107f3ed16853c1c5b2b0cbc911";
const HASH_V23_DA_350 = "6b71cb823967518955407b532904ae91";
const HASH_V24_DA_384 = "f8d6ed0c3622ab41123bacb98911a98f";

const V23 =
  "public.create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";
const V24 =
  "public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";

const HASHES = `SELECT
  md5(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('${V23}')), chr(13), '')) AS v23,
  md5(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('${V24}')), chr(13), '')) AS v24`;

const PEDIDO_DE_VISITANTE_TEM_FREIO = Object.freeze({
  nome: NOME,
  // "No ar" = as DUAS funções com o corpo desta migration (as duas caem e sobem juntas, num rollback só).
  noAr: `SELECT COALESCE((
    SELECT md5(replace(prosrc, chr(13), ''))
      FROM pg_proc WHERE oid = to_regprocedure('${V23}')
  ) = '${HASH_V23_DESTA}', false) AND COALESCE((
    SELECT md5(replace(prosrc, chr(13), ''))
      FROM pg_proc WHERE oid = to_regprocedure('${V24}')
  ) = '${HASH_V24_DESTA}', false) AS sim`,
});

/** Desfaz a 20261394000000 na transação aberta, se no ar; repetir é no-op. Devolve true se desfez. */
async function desfazerPedidoDeVisitanteTemFreioNaTransacao(cliente) {
  // A 20261394200000 (a v23 recusa o pagamento pelo app) sucede o corpo da v23 desta migration: cai ANTES, senao o pre-voo do rollback
  // da 394000 recusa com o corpo dela no ar. Ver a-v23-recusa-o-pagamento-pelo-app-posterior.cjs.
  await require("./a-v23-recusa-o-pagamento-pelo-app-posterior.cjs").desfazerV23RecusaOPagamentoPeloAppNaTransacao(
    cliente,
  );
  const r = await cliente.query(PEDIDO_DE_VISITANTE_TEM_FREIO.noAr);
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
  const h = (await cliente.query(HASHES)).rows[0];
  assert.equal(
    h.v23,
    HASH_V23_DA_350,
    "a 20261394000000 não restaurou create_marketplace_order_v23 ao corpo da 20261350000000; revise as sucessoras",
  );
  assert.equal(
    h.v24,
    HASH_V24_DA_384,
    "a 20261394000000 não restaurou create_marketplace_order_v24 ao corpo da 20261384000000; revise as sucessoras",
  );
  return true;
}

module.exports = {
  PEDIDO_DE_VISITANTE_TEM_FREIO,
  desfazerPedidoDeVisitanteTemFreioNaTransacao,
};
