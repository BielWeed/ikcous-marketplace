"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261399700000 (o painel de avaliações filtra o que está em moderação) sucede o get_admin_reviews_paged da 20261381000000: TROCA a
 * assinatura (de 4 para 5 argumentos: DROP da antiga, CREATE da nova) e mantém o gate is_admin_atual(). O rollback da 381 exige o corpo e
 * a assinatura DELA: toda prova que desfaz ou mede a 20261381 (ou a 20261197, que ela sucede) isolada tem de desfazer a 3997 PRIMEIRO,
 * na própria transação/clone. Nunca se afrouxa o pré-voo da migration anterior. `ex-admin-resto-do-painel-posterior.cjs` chama este
 * módulo antes de desfazer a 381, e os 8 chamadores daquele módulo herdam a ordem.
 */
const fs = require("node:fs");
const path = require("node:path");
const FILTRO_DE_MODERACAO = Object.freeze({
  nome: "20261399700000_o_painel_de_avaliacoes_filtra_o_que_esta_em_moderacao.sql",
  // "No ar" = a assinatura de 5 argumentos existe com o corpo desta migration (md5 do corpo sem CR).
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)'))
    = 'af5d21345d167ca44dd327a93f949ea6', false) AS sim`,
});
async function desfazerFiltroDeModeracaoNaTransacao(c) {
  // A 20261399996000 (o painel filtra o que está sem resposta) sucede o corpo desta migration na mesma assinatura: cai antes de qualquer rollback da 3997.
  await require("./o-painel-de-avaliacoes-filtra-sem-resposta-posterior.cjs").desfazerFiltroSemRespostaNaTransacao(
    c,
  );
  if ((await c.query(FILTRO_DE_MODERACAO.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${FILTRO_DE_MODERACAO.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = {
  FILTRO_DE_MODERACAO,
  desfazerFiltroDeModeracaoNaTransacao,
};
