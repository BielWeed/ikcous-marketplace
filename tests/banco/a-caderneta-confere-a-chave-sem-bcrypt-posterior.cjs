"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos literais de migration do repositório. */
/**
 * A 20261490 (a caderneta confere a chave sem bcrypt por chamada) sucede os corpos de resolver_loja e resolver_loja_com_estado da 20261460.
 * O pré-voo da 20261460 (reaplicar e rollback), da 20261470 e da 20261480 confere esses corpos pelo md5 e RECUSA (B1_BASELINE_DIVERGENT)
 * com a sucessora no ar — o comportamento certo, que não se afrouxa aqui. Toda prova viva que reaplica ou desfaz uma delas tem de desfazer
 * ANTES esta migration: o rollback COMUM (as portas voltam byte a byte aos corpos da 20261460) e o DESTRUTIVO confirmado (as colunas
 * hash_rapido/hash_rapido_de saem e frota_segredo volta à forma da 20261141). Só roda se a migration estiver no ar; roda na transação do
 * chamador (que decide se comita).
 */
const fs = require("node:fs");
const path = require("node:path");
const CHAVE_SEM_BCRYPT = Object.freeze({
  nome: "20261490000000_a_caderneta_confere_a_chave_sem_bcrypt_por_chamada.sql",
  // "No ar" = alguma das duas colunas do atalho existe (o destrutivo as tira; depois dele não há o que desfazer).
  noAr: `SELECT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.frota_segredo') AND a.attnum > 0
           AND NOT a.attisdropped AND a.attname IN ('hash_rapido', 'hash_rapido_de')) AS sim`,
});
const ler = (n) =>
  fs.readFileSync(
    path.join(__dirname, "..", "..", "supabase", "migrations", n),
    "utf8",
  );
async function desfazerChaveSemBcryptNaTransacao(c) {
  if ((await c.query(CHAVE_SEM_BCRYPT.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(ler(`rollback-manual-${CHAVE_SEM_BCRYPT.nome}`));
  await c.query(
    "SET LOCAL app.confirmo_apagar_atalho_da_chave_da_frota = 'APAGAR'",
  );
  await c.query(ler(`rollback-manual-destrutivo-${CHAVE_SEM_BCRYPT.nome}`));
  return true;
}
/** Desfaz a 20261490 numa transação própria, COMITADA (para as provas que rodam num clone exclusivo e medem a base de antes dela). */
async function desfazerChaveSemBcryptNoClone(c) {
  await c.query("BEGIN");
  try {
    const desfez = await desfazerChaveSemBcryptNaTransacao(c);
    await c.query("COMMIT");
    return desfez;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
module.exports = {
  CHAVE_SEM_BCRYPT,
  desfazerChaveSemBcryptNaTransacao,
  desfazerChaveSemBcryptNoClone,
};
