"use strict";

const { readFileSync } = require("node:fs");
const path = require("node:path");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const MIGRATION =
  "20261410000000_a_lista_do_painel_e_o_rastreio_levam_o_nome_antigo_da_opcao.sql";
const PAINEL = Object.freeze({
  assinatura:
    "public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)",
  hash: "bfef98c2eeeaf9014d92d3e4cd97764d",
});
const RASTREIO = Object.freeze({
  assinatura: "public.get_orders_by_otp_v2(text,text,text,text)",
  hash: "96f080db2a488d8887a2dfd959bd9862",
});

// O chamador controla a transação. Os dois corpos voltam juntos, nunca apenas um.
async function desfazerRotulosHistoricosNaTransacao(c) {
  lerDatabaseUrlEfemera();
  for (const alvo of [PAINEL, RASTREIO]) {
    const { rows } = await c.query(
      "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [alvo.assinatura],
    );
    if (rows[0]?.h === alvo.hash) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Nome fixo da migration, não vem de entrada.
      const rollback = readFileSync(
        path.join(
          __dirname,
          "../../supabase/migrations",
          `rollback-manual-${MIGRATION}`,
        ),
        "utf8",
      );
      await c.query(rollback);
      return;
    }
  }
}

// As provas antigas de concorrência precisam que outras conexões vejam o corpo
// anterior. A restauração persiste só no clone isolado, que será descartado.
async function prepararCloneSemRotulosHistoricos(c) {
  const url = new URL(lerDatabaseUrlEfemera());
  if (!url.pathname.startsWith("/prova_")) {
    throw new Error("Esta prova exige o clone de rodar-isolado.cjs");
  }
  await c.query("BEGIN");
  try {
    await desfazerRotulosHistoricosNaTransacao(c);
    await c.query("COMMIT");
  } catch (erro) {
    await c.query("ROLLBACK");
    throw erro;
  }
}

module.exports = {
  PAINEL,
  RASTREIO,
  prepararCloneSemRotulosHistoricos,
  desfazerRotulosHistoricosNaTransacao,
};
