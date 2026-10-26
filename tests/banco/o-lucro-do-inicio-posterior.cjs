"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261390 sucede o painel_inicio da 20261228 (só a janela do lucro estimado: do dia 1 ao último dia do mês, em vez de até
 * hoje). O rollback da 20261228 exige o corpo DELA: toda prova que desfaz ou mede a 20261228 (ou a 20261212, que ela sucede)
 * isolada tem de desfazer a 390 PRIMEIRO, na própria transação/clone. Nunca se afrouxa o pré-voo da migration anterior.
 */
const fs = require("node:fs");
const path = require("node:path");
const LUCRO_DO_INICIO = Object.freeze({
  nome: "20261390000000_o_lucro_do_inicio_conta_o_mes_inteiro.sql",
  // "No ar" = o corpo vivo de painel_inicio é o desta migration (md5 do corpo sem CR).
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.painel_inicio()'))
    = 'b4aa318b777824bd49aab4175d9133f8', false) AS sim`,
});
async function desfazerLucroDoInicioNaTransacao(c) {
  if ((await c.query(LUCRO_DO_INICIO.noAr)).rows[0]?.sim !== true) return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${LUCRO_DO_INICIO.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = { LUCRO_DO_INICIO, desfazerLucroDoInicioNaTransacao };
