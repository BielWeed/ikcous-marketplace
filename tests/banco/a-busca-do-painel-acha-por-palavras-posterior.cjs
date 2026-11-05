"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261399200000 sucede o get_admin_products_paged da 20261385 (só troca o filtro de busca: a frase inteira vira
 * palavras, todas obrigatórias). O rollback da 20261385 exige o corpo DELA: toda prova que desfaz ou mede a 20261385
 * (ou a 20261381 e a 20261213, que ela sucede) isolada tem de desfazer a 3992 PRIMEIRO, na própria transação/clone.
 * Quem já chama `desfazerBuscaDoPainelNaTransacao` (busca-do-painel-por-codigo-posterior.cjs) recebe isto de graça:
 * aquele módulo chama este antes de desfazer a 385. Nunca se afrouxa o pré-voo da migration anterior.
 */
const fs = require("node:fs");
const path = require("node:path");
const BUSCA_POR_PALAVRAS = Object.freeze({
  nome: "20261399200000_a_busca_de_produtos_do_painel_acha_por_palavras.sql",
  // "No ar" = o corpo vivo de get_admin_products_paged é o desta migration (md5 do corpo sem CR).
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.get_admin_products_paged(text,text,text,text,integer,integer)'))
    = '346063e900b8b7b63dfbeffe5070eedc', false) AS sim`,
});
async function desfazerBuscaPorPalavrasNaTransacao(c) {
  if ((await c.query(BUSCA_POR_PALAVRAS.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${BUSCA_POR_PALAVRAS.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = { BUSCA_POR_PALAVRAS, desfazerBuscaPorPalavrasNaTransacao };
