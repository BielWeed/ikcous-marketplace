"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos montados de literais do repositorio, nunca de entrada de rede. */
// Somente nos clones efemeros: as provas antigas medem o upsert_store_config da 20261310000000 e o
// salvar_politica_de_devolucao da 20261199000000 exatos. A 20261643000000 (as listas dos ajustes nao somem entre
// aparelhos) redefine os dois corpos; desfazer a 1643 devolve os dois, de uma vez, pelo rollback-manual dela.
// Idempotente: so desfaz se os DOIS corpos desta estiverem no ar. Devolve true se desfez.
const fs = require("node:fs");
const path = require("node:path");

const NOME =
  "20261643000000_as_listas_dos_ajustes_nao_somem_entre_aparelhos.sql";
const HASH_UPSERT_DESTA = "2f772ffd1370359ba6c64540b71c35b2";
const HASH_POLITICA_DESTA = "976f05a67ca929ace608a62391588bcd";

async function desfazerAsListasDosAjustesNaTransacao(c) {
  if (process.env.CI_BANCO_EFEMERO !== "1")
    throw new Error("Exige banco efemero");
  const vivo = await c.query(
    `SELECT
       (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.upsert_store_config(jsonb)')) AS up,
       (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.salvar_politica_de_devolucao(jsonb)')) AS po`,
  );
  const { up, po } = vivo.rows[0] ?? {};
  if (up !== HASH_UPSERT_DESTA || po !== HASH_POLITICA_DESTA) return false;
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
  desfazerAsListasDosAjustesNaTransacao,
  HASH_UPSERT_DESTA,
  HASH_POLITICA_DESTA,
  NOME_DA_MIGRATION: NOME,
};
