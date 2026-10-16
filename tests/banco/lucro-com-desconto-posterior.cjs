"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261245 sucede o analytics da 42. Toda prova que mede a 42 isolada (apply,
 * rollback ou comparação de corpos) tem de desfazer a 45 PRIMEIRO, na própria
 * transação/clone. Nunca se afrouxa o pré-voo da migration anterior.
 */
const fs = require("node:fs");
const path = require("node:path");
const LUCRO_COM_DESCONTO = Object.freeze({
  nome: "20261245000000_o_lucro_desconta_o_cupom_do_pedido.sql",
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.get_admin_analytics_v2(integer)'))
    = 'ab25e738a3101cccbb0c09450b660ee0', false) AS sim`,
});
async function desfazerLucroComDescontoNaTransacao(c) {
  if ((await c.query(LUCRO_COM_DESCONTO.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${LUCRO_COM_DESCONTO.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = { LUCRO_COM_DESCONTO, desfazerLucroComDescontoNaTransacao };
