"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Arquivo fixo de migration do repositório. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const NOME = "20261405600000_cancelar_retirada_pronta.sql";
const ASSINATURA =
  "public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)";
const sqlHash =
  "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)";
const hashVivo = async (c) => (await c.query(sqlHash, [ASSINATURA])).rows[0]?.h;

// Só no clone efêmero, antes de provar a migration 20261198000000 isoladamente.
async function desfazerCancelarRetiradaProntaNaTransacao(c) {
  if ((await hashVivo(c)) === "1c44358ad6c8d68b643a42b2ccdb6e96") {
    await c.query(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "supabase",
          "migrations",
          "rollback-manual-20261405700000_cancelar_pedido_do_painel_confere_a_etapa.sql",
        ),
        "utf8",
      ),
    );
    assert.equal(await hashVivo(c), "fea4db42491c2e229a5ac8ee9484d909");
  }
  if ((await hashVivo(c)) !== "fea4db42491c2e229a5ac8ee9484d909") return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${NOME}`,
      ),
      "utf8",
    ),
  );
  assert.equal(await hashVivo(c), "4623b27a07468553d6ac00a888e04db4");
  return true;
}

module.exports = { desfazerCancelarRetiradaProntaNaTransacao };
