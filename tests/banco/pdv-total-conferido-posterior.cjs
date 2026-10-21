"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
const fs = require("node:fs");
const path = require("node:path");

// Provas históricas medem a 249 ou a 235, não a nova assinatura da 280.
// O chamador só opera no clone efêmero e decide BEGIN/ROLLBACK.
async function desfazerTotalConferidoNaTransacao(c) {
  const r =
    await c.query(`SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid=to_regprocedure(
      'public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid,numeric)'))
    = '79b779b98a5d6f6205a31309d5593eb9',false) AS sim`);
  if (r.rows[0]?.sim !== true) return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../supabase/migrations",
        "rollback-manual-20261280000000_o_balcao_registra_so_o_total_conferido.sql",
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = { desfazerTotalConferidoNaTransacao };
