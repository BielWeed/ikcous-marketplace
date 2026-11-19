"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261399600000 sucede o fin_dre da 382 (o CMV deixa de ter piso em zero e a linha do CMV aparece
 * também quando é crédito). Toda prova que mede a 382 isolada (apply, rollback ou comparação de corpos)
 * tem de desfazer a 3996 PRIMEIRO, na própria transação/clone. Nunca se afrouxa o pré-voo da migration
 * anterior. A cadeia é 242 -> 382 -> 3996: `fin-dre-sinal-posterior.cjs` chama este módulo antes de
 * desfazer a 382, e `lucro-com-desconto-posterior.cjs` chama aquele antes de desfazer a 242.
 */
const fs = require("node:fs");
const path = require("node:path");
const CREDITO_DO_CMV = Object.freeze({
  nome: "20261399600000_o_resultado_credita_o_custo_da_devolucao_de_outro_mes.sql",
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.fin_dre(date,date)'))
    = 'eafc6a2c4663e33f5459791c6601b848', false) AS sim`,
});
async function desfazerCustoDoCancelamentoNaTransacao(c) {
  const { rows } = await c.query(
    `SELECT md5(replace(prosrc, chr(13), '')) AS hash FROM pg_proc
      WHERE oid = to_regprocedure('public.fin_dre(date,date)')`,
  );
  if (rows[0]?.hash !== "a27c9649621b3ac1502f458576120259") return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../supabase/migrations/rollback-manual-20261405900000_o_custo_do_cancelamento_fica_no_mes_da_volta.sql",
      ),
      "utf8",
    ),
  );
  return true;
}

async function desfazerCreditoDoCmvNaTransacao(c) {
  await desfazerCustoDoCancelamentoNaTransacao(c);
  if ((await c.query(CREDITO_DO_CMV.noAr)).rows[0]?.sim !== true) return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${CREDITO_DO_CMV.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = {
  CREDITO_DO_CMV,
  desfazerCreditoDoCmvNaTransacao,
  desfazerCustoDoCancelamentoNaTransacao,
};
