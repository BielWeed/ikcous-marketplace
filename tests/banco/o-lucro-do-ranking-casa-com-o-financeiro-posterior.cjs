"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261399995000 sucede o get_admin_analytics_v2 da 20261399994000 (o lucro por produto passa a casar com o Financeiro,
 * pedido a pedido: o pedido 'estornado' entra e o dinheiro devolvido, de qualquer caminho, sai do lucro). Toda prova que mede a 3994
 * isolada (apply, rollback ou comparação de corpos) tem de desfazer a 3995 PRIMEIRO, na própria transação/clone. Nunca se afrouxa o
 * pré-voo da migration anterior. A cadeia é ... -> 251 -> 3997 -> 3994 -> 3995: `o-item-que-nao-veio-fica-com-a-cliente-posterior.cjs`
 * chama este módulo antes de desfazer a 3994, `o-ranking-de-lucro-posterior.cjs` chama aquele antes de desfazer a 3997 e
 * `lucro-do-estoque-posterior.cjs` chama aquele antes de desfazer a 251.
 */
const fs = require("node:fs");
const path = require("node:path");
const LUCRO_CASA_COM_O_FINANCEIRO = Object.freeze({
  nome: "20261399995000_o_lucro_do_ranking_casa_com_o_financeiro_pedido_a_pedido.sql",
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.get_admin_analytics_v2(integer)'))
    = '4f8fb94f6cb0018e10d0ef71541f1cbf', false) AS sim`,
});
async function desfazerLucroCasaComOFinanceiroNaTransacao(c) {
  if ((await c.query(LUCRO_CASA_COM_O_FINANCEIRO.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${LUCRO_CASA_COM_O_FINANCEIRO.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = {
  LUCRO_CASA_COM_O_FINANCEIRO,
  desfazerLucroCasaComOFinanceiroNaTransacao,
};
