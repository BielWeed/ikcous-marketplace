"use strict";
// Definicao unica da 20261630000000 (a loja ja suspensa tambem pausa) para as provas que desfazem as migrations POSTERIORES antes de medir
// uma anterior. A 1630 e' SUCESSORA da 20261600000000: troca o corpo de marcar_suspensa_desde. Com ela no ar, o rollback comum da 1600
// recusa (B1_BASELINE_DIVERGENT: a marca tem corpo desconhecido para ele) e o pre-voo da 1600 recusa reaplicar. Quem chama:
//   - desfazerAPausaDeVendas (a-loja-pausa-o-pedido-novo-posterior.cjs): as provas da 20261590000000 e da 20261399998000;
//   - a prova viva da 20261600000000 (a-loja-pausa-o-pedido-novo-viva.cjs), antes de medir;
//   - desfazerPosterioresNaTransacao de admin-atual-viva.cjs e pagamentos-rpc-viva.cjs, ANTES do laco de POSTERIORES_A_97 (a entrada
//     PAUSA_DE_VENDAS roda o rollback comum da 1600). A marca nao chama is_admin_atual: a 1630 nao entra na lista, so sai antes dela.
//
// Roda o rollback COMUM desta (a marca volta byte a byte ao corpo da 1600; nao ha destrutivo) na transacao de quem chama. O rollback tem
// pre-voo proprio e recusa estado desconhecido: isto nao afrouxa nada. So no Postgres EFEMERO (quem chama ja passou pela trava de
// efemero.cjs) e so no clone do rodar-isolado.cjs. No-op quando a 1630 nao esta no ar.

/* eslint-disable security/detect-non-literal-fs-filename -- caminhos fixos das migrations versionadas, sem entrada externa. */
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261630000000_a_loja_ja_suspensa_tambem_pausa.sql";
const PASTA = path.resolve(__dirname, "..", "..", "supabase", "migrations");
const ler = (arq) =>
  fs.readFileSync(path.join(PASTA, arq), "utf8").replace(/\r\n/g, "\n");

/** A 1630 esta no ar se a marca tem o corpo dela (md5 sem CR). */
const NO_AR = `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
    WHERE oid = to_regprocedure('public.marcar_suspensa_desde()')) = '974c4efadc6876427ffe740312c7619b', false) AS sim`;

/** Desfaz a 1630 na transacao ja aberta por quem chama. Devolve true se desfez. */
async function desfazerASuspensaAntigaNaTransacao(c) {
  if (!(await c.query(NO_AR)).rows[0].sim) return false;
  await c.query(ler(`rollback-manual-${NOME}`));
  return true;
}

/** Desfaz a 1630 numa transacao propria (COMMIT no clone). Devolve true se desfez. */
async function desfazerASuspensaAntiga(c) {
  await c.query("BEGIN");
  try {
    const desfez = await desfazerASuspensaAntigaNaTransacao(c);
    await c.query("COMMIT");
    return desfez;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

const A_SUSPENSA_ANTIGA = Object.freeze({ nome: NOME, noAr: NO_AR });

module.exports = {
  desfazerASuspensaAntiga,
  desfazerASuspensaAntigaNaTransacao,
  A_SUSPENSA_ANTIGA,
};
