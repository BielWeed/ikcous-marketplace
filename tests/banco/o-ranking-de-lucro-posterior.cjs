"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261399970000 sucede o get_admin_analytics_v2 da 251 (o ranking de lucro e o lucro do gráfico diário
 * descontam a devolução e o estorno). Toda prova que mede a 251 isolada (apply, rollback ou comparação de
 * corpos) tem de desfazer a 3997 PRIMEIRO, na própria transação/clone. Nunca se afrouxa o pré-voo da migration
 * anterior. A cadeia é ... -> 250 -> 251 -> 3997: `lucro-do-estoque-posterior.cjs` chama este módulo antes de
 * desfazer a 251, e `faturamento-potencial-posterior.cjs` chama aquele antes de desfazer a 250.
 */
const fs = require("node:fs");
const path = require("node:path");
const RANKING_DE_LUCRO = Object.freeze({
  nome: "20261399970000_o_ranking_de_lucro_desconta_a_devolucao.sql",
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.get_admin_analytics_v2(integer)'))
    = 'e9b8671e919d885277dbbff74496fc46', false) AS sim`,
});
async function desfazerRankingDeLucroNaTransacao(c) {
  if ((await c.query(RANKING_DE_LUCRO.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${RANKING_DE_LUCRO.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = { RANKING_DE_LUCRO, desfazerRankingDeLucroNaTransacao };
