"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Caminhos compostos apenas de nomes fixos de migrations/consultas deste repositorio;
 * nenhum caminho vem de rede, de credencial ou de entrada de usuario. */
// Somente clone efemero: desfaça a 343 antes de medir a 241 e seus ancestrais.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const REEMBOLSO_MANUAL_RESERVA = Object.freeze({
  nome: "20261343000000_o_reembolso_manual_respeita_a_reserva.sql",
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)'))
    = 'ea651d52157521c0fe7ffccc948b4b1a', false) AS sim`,
});
async function desfazerReembolsoManualReservaNaTransacao(c) {
  if ((await c.query(REEMBOLSO_MANUAL_RESERVA.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../supabase/migrations",
        `rollback-manual-${REEMBOLSO_MANUAL_RESERVA.nome}`,
      ),
      "utf8",
    ),
  );
  assert.equal(
    (
      await c.query(`SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc
    WHERE oid = to_regprocedure('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)')`)
    ).rows[0].h,
    "ebb901efff59a53082836a13e053cd1a",
  );
  return true;
}
module.exports = {
  REEMBOLSO_MANUAL_RESERVA,
  desfazerReembolsoManualReservaNaTransacao,
};
