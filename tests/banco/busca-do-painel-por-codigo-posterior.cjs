"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261385 sucede o get_admin_products_paged da 20261381 (so amplia o filtro de busca). O rollback da 20261381 exige o
 * corpo DELA: toda prova que desfaz ou mede a 20261381 (ou a 20261213, que ela sucede) isolada tem de desfazer a 385
 * PRIMEIRO, na própria transação/clone. Nunca se afrouxa o pré-voo da migration anterior.
 */
const fs = require("node:fs");
const path = require("node:path");
const BUSCA_DO_PAINEL = Object.freeze({
  nome: "20261385000000_a_busca_de_produtos_do_painel_acha_pelo_codigo_de_barras_e_da_variacao.sql",
  // "No ar" = o corpo vivo de get_admin_products_paged e o desta migration (md5 do corpo sem CR).
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.get_admin_products_paged(text,text,text,text,integer,integer)'))
    = '39db382689def5fac3b263a66f84ede1', false) AS sim`,
});
async function desfazerBuscaDoPainelNaTransacao(c) {
  if ((await c.query(BUSCA_DO_PAINEL.noAr)).rows[0]?.sim !== true) return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${BUSCA_DO_PAINEL.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = { BUSCA_DO_PAINEL, desfazerBuscaDoPainelNaTransacao };
