"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261399800000 (as recomendações do produto contam o estoque das variações) sucede o get_product_recommendations da 20261394100000:
 * troca só o filtro do estoque e mantém o teto do limite. O pré-voo da 20261394100000 e o rollback dela só aceitam o corpo DELA (ou o da
 * 20261160000000, que ela troca): toda prova que reaplica ou desfaz a 20261394100000 sobre a árvore já migrada tem de desfazer a 3998
 * PRIMEIRO, na própria transação. Nunca se afrouxa o pré-voo da migration anterior. `a-lista-de-recomendacoes-do-produto-tem-teto-viva.cjs`
 * chama este módulo antes de reaplicar a 394100 sobre o estado da árvore.
 */
const fs = require("node:fs");
const path = require("node:path");
const RECOMENDACOES_COM_GRADE = Object.freeze({
  nome: "20261399800000_as_recomendacoes_do_produto_contam_o_estoque_das_variacoes.sql",
  // "No ar" = a função existe com o corpo desta migration (md5 do corpo sem CR).
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.get_product_recommendations(uuid,integer)'))
    = '9b9fa184eb3984e8afd3ec0f80a086e7', false) AS sim`,
});
async function desfazerContaDasVariacoesNaTransacao(c) {
  if ((await c.query(RECOMENDACOES_COM_GRADE.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${RECOMENDACOES_COM_GRADE.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = {
  RECOMENDACOES_COM_GRADE,
  desfazerContaDasVariacoesNaTransacao,
};
