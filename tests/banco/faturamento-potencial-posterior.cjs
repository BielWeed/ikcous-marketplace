"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositorio. */
const fs = require("node:fs");
const path = require("node:path");

async function desfazerFaturamentoPotencialNaTransacao(c) {
  await require("./lucro-do-estoque-posterior.cjs").desfazerLucroDoEstoqueNaTransacao(c);
  const r =
    await c.query(`SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.get_admin_analytics_v2(integer)'))
    = '5746d8a1df216ca4a5569901c45a2a07', false) AS sim`);
  if (r.rows[0]?.sim !== true) return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        "rollback-manual-20261250000000_o_faturamento_potencial_conta_todo_o_estoque.sql",
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = { desfazerFaturamentoPotencialNaTransacao };
