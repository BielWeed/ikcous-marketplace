"use strict";

/**
 * A 20261270000000 redefine concluir_estorno e pagamentos_a_reconciliar.
 * As provas históricas da 226 e da 241 precisam dos corpos anteriores:
 * desfazem esta sucessora ANTES da 241, só na transação do clone efêmero.
 * O rollback mantém dados e ACL; o chamador decide BEGIN/COMMIT/ROLLBACK.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho é montado de literais deste arquivo (a migration do repositório). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HASH_CONCLUIR = `SELECT md5(replace(prosrc, chr(13), '')) AS hash
  FROM pg_proc WHERE oid = to_regprocedure('public.concluir_estorno(uuid,text,text,text)')`;
const PAGAMENTO_ADIANTADO = Object.freeze({
  nome: "20261270000000_pagamento_adiantado_e_estorno_antes_da_confirmacao.sql",
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.concluir_estorno(uuid,text,text,text)'))
    = '1738457c2b95c5c3709beed42e656394', false) AS sim`,
});

/** Desfaz a 270 na transação aberta, se no ar; repetir é no-op. Devolve true se desfez. */
async function desfazerPagamentoAdiantadoNaTransacao(cliente) {
  const r = await cliente.query(PAGAMENTO_ADIANTADO.noAr);
  if (r.rows[0]?.sim !== true) return false;
  await cliente.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../supabase/migrations",
        `rollback-manual-${PAGAMENTO_ADIANTADO.nome}`,
      ),
      "utf8",
    ),
  );
  const restaurado = await cliente.query(HASH_CONCLUIR);
  assert.equal(
    restaurado.rows[0]?.hash,
    "662daf0dfc065a820231e9d30f4f6275",
    "a 270 não restaurou concluir_estorno ao corpo histórico; revise as sucessoras",
  );
  return true;
}

module.exports = { PAGAMENTO_ADIANTADO, desfazerPagamentoAdiantadoNaTransacao };
