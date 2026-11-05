"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261399400000 sucede as DUAS sobrecargas de reply_review_atomic da 20261360000000 (só ganham o passo 3: o aviso no sino da
 * cliente que avaliou). O rollback da 20261360000000 só aceita o corpo da 1360 ou o de antes dela: toda prova que desfaz ou mede a
 * 1360 (e, por baixo dela, a 20261197000000 e a 20261240000000) tem de desfazer esta PRIMEIRO, na própria transação/clone.
 * Quem já chama `desfazerExAdminNaTransacao` (ex-admin-demais-tabelas-posterior.cjs) recebe isto de graça: aquele módulo chama
 * este antes de desfazer a 1360. Nunca se afrouxa o pré-voo da migration anterior.
 */
const fs = require("node:fs");
const path = require("node:path");
const AVISO_DA_AVALIACAO = Object.freeze({
  nome: "20261399400000_a_cliente_e_avisada_quando_a_loja_responde_sua_avaliacao.sql",
  // "No ar" = o corpo vivo de reply_review_atomic(uuid,text) é o desta migration (md5 do corpo sem CR); o da sobrecarga de 3 argumentos
  // vai junto (o rollback exige os dois).
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.reply_review_atomic(uuid,text)'))
    = 'f617966c37037537410c3c78d85b8785', false) AS sim`,
});
async function desfazerAvisoDaAvaliacaoNaTransacao(c) {
  if ((await c.query(AVISO_DA_AVALIACAO.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${AVISO_DA_AVALIACAO.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = {
  AVISO_DA_AVALIACAO,
  desfazerAvisoDaAvaliacaoNaTransacao,
};
