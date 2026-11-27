"use strict";
// Desfaz a 20261590000000 (a loja guarda o dia da pausa do teste) para as provas que medem a 20261399998000 isolada
// (a-loja-recebe-o-plano-por-porta-unica-viva.cjs). A 1590 e' SUCESSORA da porta da 1399998000: troca o corpo de
// assinatura_da_loja_gravar e poe a 14a coluna em assinatura_da_loja. Com ela no ar, o pre-voo da 1399998000 recusa
// reaplicar (exige o md5 565f82... e a forma de 13 colunas) e as provas dela ficam vermelhas por um estado que nao e' delas.
//
// Roda os DOIS degraus, na ordem e numa transacao so: o rollback comum (a porta volta byte a byte) e o destrutivo (a
// coluna sai; com a confirmacao SET LOCAL que ele exige). Antes, a sucessora 20261600000000 (que le pausa_em) sai pelo rollback comum dela. Os dois tem pre-voo proprio e recusam estado desconhecido: isto
// nao afrouxa nada. So no Postgres EFEMERO (quem chama ja passou pela trava de efemero.cjs) e so no clone do
// rodar-isolado.cjs: o COMMIT fica no clone, que some no fim. No-op quando a 1590 nao esta no ar.

/* eslint-disable security/detect-non-literal-fs-filename -- caminhos fixos das migrations versionadas, sem entrada externa. */
const fs = require("node:fs");
const path = require("node:path");
const {
  desfazerAPausaDeVendas,
} = require("./a-loja-pausa-o-pedido-novo-posterior.cjs");

const NOME = "20261590000000_a_loja_guarda_o_dia_da_pausa_do_teste.sql";
const PASTA = path.resolve(__dirname, "..", "..", "supabase", "migrations");
const ler = (arq) =>
  fs.readFileSync(path.join(PASTA, arq), "utf8").replace(/\r\n/g, "\n");

/** A 1590 esta no ar se a coluna existe ou se a porta nao e a da 1399998000. */
const NO_AR = `SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.assinatura_da_loja') AND attname = 'pausa_em' AND NOT attisdropped)
    OR (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('public.assinatura_da_loja_gravar(text, jsonb, boolean)'))
       IS DISTINCT FROM '565f82cb9a65ed96e4702db9d97bf0d6' AS sim`;

async function desfazerODiaDaPausa(c) {
  // A sucessora 20261600000000 le pausa_em: sai ANTES (senao o destrutivo daqui recusa com PAUSA_EM_USO).
  await desfazerAPausaDeVendas(c);
  if (!(await c.query(NO_AR)).rows[0].sim) return false;
  await c.query("BEGIN");
  try {
    await c.query(ler(`rollback-manual-${NOME}`));
    await c.query("SET LOCAL app.confirmo_apagar_pausa_em = 'APAGAR'");
    await c.query(ler(`rollback-manual-destrutivo-${NOME}`));
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
  return true;
}

module.exports = { desfazerODiaDaPausa, A_PAUSA_DO_TESTE: NOME };
