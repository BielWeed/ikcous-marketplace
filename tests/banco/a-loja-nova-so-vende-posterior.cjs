"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos montados de literais do repositorio, nunca de entrada de rede. */
// Somente nos clones efemeros: a 20261655000000 (a loja nova so vende o que confirmou) poe na vitrine (v_store_config)
// duas colunas calculadas das datas da 20261652000000, entao o rollback da 1652 (que apaga essas colunas) recusa com
// ela no ar. Quem desfaz a 1652 desfaz esta antes, pelo rollback-manual dela.
// Idempotente: so desfaz se o corpo desta estiver no ar. Devolve true se desfez.
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261655000000_a_loja_nova_so_vende_o_que_confirmou.sql";
const HASH_ACEITA_DESTA = "a38a13934096d55b10fcfdb1416a9c08";

async function desfazerSoVendeOConfirmadoNaTransacao(c) {
  if (process.env.CI_BANCO_EFEMERO !== "1")
    throw new Error("Exige banco efemero");
  const vivo = await c.query(
    "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('public.forma_de_pagamento_aceita(text)')",
  );
  if (vivo.rows[0]?.h !== HASH_ACEITA_DESTA) return false;
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
  desfazerSoVendeOConfirmadoNaTransacao,
  HASH_ACEITA_DESTA,
  NOME_DA_MIGRATION: NOME,
};
