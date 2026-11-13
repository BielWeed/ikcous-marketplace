"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261399996000 (o painel de avaliações filtra o que está sem resposta) sucede o get_admin_reviews_paged da 20261399700000 NA
 * MESMA assinatura de 5 argumentos (só acrescenta o terceiro valor de p_status). Toda prova que mede a 3997 isolada (apply, rollback
 * ou comparação de corpos) tem de desfazer a 3996 PRIMEIRO, na própria transação/clone: o rollback da 3997 só aceita o corpo DELA.
 * Nunca se afrouxa o pré-voo da migration anterior. A cadeia é ... -> 381 -> 3997 -> 3996: `o-painel-de-avaliacoes-filtra-posterior.cjs`
 * chama este módulo antes de desfazer a 3997, e `ex-admin-resto-do-painel-posterior.cjs` chama aquele antes de desfazer a 381.
 */
const fs = require("node:fs");
const path = require("node:path");
const FILTRO_SEM_RESPOSTA = Object.freeze({
  nome: "20261399996000_o_painel_de_avaliacoes_filtra_o_que_esta_sem_resposta.sql",
  // "No ar" = a assinatura de 5 argumentos existe com o corpo desta migration (md5 do corpo sem CR).
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)'))
    = '75f5c48de4eb4005a2516e54b3d33135', false) AS sim`,
});
async function desfazerFiltroSemRespostaNaTransacao(c) {
  if ((await c.query(FILTRO_SEM_RESPOSTA.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${FILTRO_SEM_RESPOSTA.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = {
  FILTRO_SEM_RESPOSTA,
  desfazerFiltroSemRespostaNaTransacao,
};
