"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261641000000 (uma avaliação por cliente e produto, e a média do painel só das publicadas) sucede o get_admin_reviews_paged da
 * 20261399996000 e o get_reviews_metrics da 20261381000000 NAS MESMAS assinaturas, e cria o gatilho BEFORE INSERT
 * tr_avaliacao_uma_por_cliente_e_produto em reviews. Toda prova que mede a 3996 ou a 381 isoladas (apply, rollback ou comparação de
 * corpos) tem de desfazer ESTA primeiro, na própria transação/clone: os rollbacks delas só aceitam o corpo DELAS. Nunca se afrouxa o
 * pré-voo da migration anterior. A cadeia é ... -> 381 -> 3997 -> 3996 -> 3641: `o-painel-de-avaliacoes-filtra-sem-resposta-posterior.cjs`
 * chama este módulo antes de desfazer a 3996 (e por ela, todas as provas que desfazem a 3997 e a 381).
 * O rollback-manual desta tira o gatilho e a função dele e devolve os dois corpos byte a byte; nenhuma linha muda.
 */
const fs = require("node:fs");
const path = require("node:path");
const UMA_AVALIACAO_POR_CLIENTE = Object.freeze({
  nome: "20261641000000_uma_avaliacao_por_cliente_e_a_media_do_painel_so_das_publicadas.sql",
  // "No ar" = a função do gatilho existe (só esta migration a cria; o rollback a apaga).
  noAr: `SELECT to_regprocedure('public.avaliacao_uma_por_cliente_e_produto()') IS NOT NULL AS sim`,
});
async function desfazerUmaAvaliacaoPorClienteNaTransacao(c) {
  if ((await c.query(UMA_AVALIACAO_POR_CLIENTE.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${UMA_AVALIACAO_POR_CLIENTE.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = {
  UMA_AVALIACAO_POR_CLIENTE,
  desfazerUmaAvaliacaoPorClienteNaTransacao,
};
