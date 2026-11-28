"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos montados de literais do repositorio, nunca de entrada de rede. */
// Somente nos clones efemeros: as provas antigas medem o upsert_store_config da 20261643000000 (e os da cadeia dela)
// exato. A 20261652000000 (a loja nova confirma a entrega e o pagamento) redefine esse corpo e poe duas colunas em
// store_config; desfazer a 1652 devolve o corpo e tira as duas colunas, pelo rollback-manual dela.
// Idempotente: so desfaz se o corpo desta estiver no ar. Devolve true se desfez.
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261652000000_a_loja_nova_confirma_entrega_e_pagamento.sql";
const HASH_UPSERT_DESTA = "3c62896ca905200f1a931ac6ccfed297";

async function desfazerConfirmacaoDaLojaNovaNaTransacao(c) {
  if (process.env.CI_BANCO_EFEMERO !== "1")
    throw new Error("Exige banco efemero");
  // A 20261655000000 (a loja nova so vende o que confirmou) le as duas colunas desta na vitrine: o rollback daqui so
  // as apaga com ela fora do ar.
  await require("./a-loja-nova-so-vende-posterior.cjs").desfazerSoVendeOConfirmadoNaTransacao(
    c,
  );
  const vivo = await c.query(
    "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('public.upsert_store_config(jsonb)')",
  );
  if (vivo.rows[0]?.h !== HASH_UPSERT_DESTA) return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../supabase/migrations",
        `rollback-manual-${NOME}`,
      ),
      "utf8",
    ),
  );
  return true;
}

module.exports = {
  desfazerConfirmacaoDaLojaNovaNaTransacao,
  HASH_UPSERT_DESTA,
  NOME_DA_MIGRATION: NOME,
};
