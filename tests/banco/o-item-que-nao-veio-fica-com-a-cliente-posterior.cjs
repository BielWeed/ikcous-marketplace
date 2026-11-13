"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261399994000 sucede o get_admin_analytics_v2 da 20261399970000 (o item que a lojista marcou "Não veio" deixa de
 * contar como perda no ranking de lucro e no lucro do gráfico diário). Toda prova que mede a 3997 isolada (apply,
 * rollback ou comparação de corpos) tem de desfazer a 3994 PRIMEIRO, na própria transação/clone. Nunca se afrouxa o
 * pré-voo da migration anterior. A cadeia é ... -> 251 -> 3997 -> 3994: `o-ranking-de-lucro-posterior.cjs` chama este
 * módulo antes de desfazer a 3997, e `lucro-do-estoque-posterior.cjs` chama aquele antes de desfazer a 251.
 */
const fs = require("node:fs");
const path = require("node:path");
const ITEM_NAO_VEIO_NO_LUCRO = Object.freeze({
  nome: "20261399994000_o_item_que_nao_veio_fica_com_a_cliente_no_ranking_de_lucro.sql",
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.get_admin_analytics_v2(integer)'))
    = 'de8648a7783c12f1be7abd7986c8a2fc', false) AS sim`,
});
async function desfazerItemQueNaoVeioNoLucroNaTransacao(c) {
  if ((await c.query(ITEM_NAO_VEIO_NO_LUCRO.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${ITEM_NAO_VEIO_NO_LUCRO.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = {
  ITEM_NAO_VEIO_NO_LUCRO,
  desfazerItemQueNaoVeioNoLucroNaTransacao,
};
