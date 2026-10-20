"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositorio. */
const fs = require("node:fs");
const path = require("node:path");

// Desfaz a 251 PRIMEIRO nas provas de ancestrais, sem afrouxar seus preflights.
async function desfazerLucroDoEstoqueNaTransacao(c) {
  const r =
    await c.query(`SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.get_admin_analytics_v2(integer)'))
    = '060c9ab5b1505dc375b41e4436e9d3a8', false) AS sim`);
  if (r.rows[0]?.sim !== true) return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        "rollback-manual-20261251000000_o_lucro_do_estoque_usa_o_preco_da_variante.sql",
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = { desfazerLucroDoEstoqueNaTransacao };
