"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261645000000 (o aviso do vale-troca diz que a loja combina) sucede o corpo de devolucao_avisa_o_cliente da
 * 20261241000000 na MESMA assinatura (só a frase do ramo vale muda). O pré-voo do rollback da 20261241000000 (e o da
 * própria 20261241000000, ao reaplicar) só aceita o corpo DELA: toda prova que desfaz ou reaplica a 20261241000000 tem
 * de desfazer ESTA primeiro, na própria transação. Nunca se afrouxa o pré-voo da migration anterior.
 * `reembolso-em-duvida-posterior.cjs` chama este módulo antes de desfazer a 20261241000000 (e por ela, todas as provas
 * que desfazem a 1196/1198/1201/1225/1226 ou a cadeia até a 97). O rollback-manual desta só devolve o corpo byte a
 * byte; nenhuma linha muda.
 */
const fs = require("node:fs");
const path = require("node:path");
const AVISO_DO_VALE_TROCA = Object.freeze({
  nome: "20261645000000_o_aviso_do_vale_troca_diz_que_a_loja_combina.sql",
  // "No ar" = o corpo vivo é exatamente o que esta migration deixa.
  noAr: `SELECT md5(replace(prosrc, E'\\r', '')) = '68792e520aa47e6e62330718430d82a8' AS sim
           FROM pg_proc WHERE oid = to_regprocedure('public.devolucao_avisa_o_cliente()')`,
});
/** Desfaz a 20261645000000 na transação aberta do cliente, se ela estiver no ar. Devolve true se desfez. */
async function desfazerAvisoDoValeTrocaNaTransacao(c) {
  if ((await c.query(AVISO_DO_VALE_TROCA.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${AVISO_DO_VALE_TROCA.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = {
  AVISO_DO_VALE_TROCA,
  desfazerAvisoDoValeTrocaNaTransacao,
};
