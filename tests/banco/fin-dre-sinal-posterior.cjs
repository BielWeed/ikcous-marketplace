"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261382 sucede o fin_dre da 42 (so o sinal das linhas do grupo financeiro). Toda prova que
 * mede a 42 isolada (apply, rollback ou comparação de corpos) tem de desfazer a 382 PRIMEIRO, na
 * própria transação/clone. Nunca se afrouxa o pré-voo da migration anterior.
 */
const fs = require("node:fs");
const path = require("node:path");
const SINAL_DA_DRE = Object.freeze({
  nome: "20261382000000_o_resultado_mostra_tarifa_juro_e_quebra_como_despesa.sql",
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.fin_dre(date,date)'))
    = '2d191bc8120a9b188c04eeaaa0263110', false) AS sim`,
});
async function desfazerSinalDaDreNaTransacao(c) {
  if ((await c.query(SINAL_DA_DRE.noAr)).rows[0]?.sim !== true) return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${SINAL_DA_DRE.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = { SINAL_DA_DRE, desfazerSinalDaDreNaTransacao };
