"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos montados de literais do repositorio, nunca de entrada de rede. */
// Somente nos clones efemeros: as provas antigas medem o esquema anterior exato.
const fs = require("node:fs");
const path = require("node:path");
async function desfazerEstiloCardFreteNaTransacao(c) {
  if (process.env.CI_BANCO_EFEMERO !== "1")
    throw new Error("Exige banco efemero");
  const vivo = await c.query(
    "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('public.upsert_store_config(jsonb)')",
  );
  if (vivo.rows[0]?.h !== "aa4ed730ac6ad3d3c2644b4285ff39a9") return false;
  const dir = path.join(__dirname, "../../supabase/migrations");
  await c.query(
    fs.readFileSync(
      path.join(
        dir,
        "rollback-manual-20261310000000_estilo_do_card_de_frete.sql",
      ),
      "utf8",
    ),
  );
  const antigo = fs.readFileSync(
    path.join(dir, "20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql"),
    "utf8",
  );
  const view = antigo.match(
    /CREATE OR REPLACE VIEW public.v_store_config[\s\S]*?WHERE id = 1;/,
  )[0];
  await c.query(
    "DROP VIEW public.v_store_config; ALTER TABLE public.store_config DROP COLUMN free_shipping_card_style;",
  );
  await c.query(view);
  await c.query(
    "GRANT ALL ON public.v_store_config TO anon, authenticated, service_role",
  );
  return true;
}
module.exports = { desfazerEstiloCardFreteNaTransacao };
