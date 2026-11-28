"use strict";
// Definicao unica da 20261661000000 (a loja que saiu pausa o pedido novo) para as provas que desfazem as migrations POSTERIORES antes de medir
// uma anterior. A 1661 e' SUCESSORA da 20261600000000: troca o corpo de motivo_da_loja_nao_aceitar_pedido. Com ela no ar, o rollback comum da
// 1600 recusa (B1_BASELINE_DIVERGENT: o motivo tem corpo desconhecido para ele) e o pre-voo da 1600 recusa reaplicar. Quem chama:
//   - desfazerAPausaDeVendas (a-loja-pausa-o-pedido-novo-posterior.cjs): as provas da 20261590000000 e da 20261399998000;
//   - as provas vivas da 20261600000000 (a-loja-pausa-o-pedido-novo-viva.cjs) e da 20261630000000 (a-loja-ja-suspensa-tambem-pausa-viva.cjs),
//     antes de medir (as duas rodam o rollback da 1600);
//   - desfazerPosterioresNaTransacao de admin-atual-viva.cjs e pagamentos-rpc-viva.cjs, ANTES do laco de POSTERIORES_A_97 (a entrada
//     PAUSA_DE_VENDAS roda o rollback comum da 1600). O motivo nao chama is_admin_atual: a 1661 nao entra na lista, so sai antes dela.
//
// Roda o rollback COMUM desta (o motivo volta byte a byte ao corpo da 1600; nao ha destrutivo) na transacao de quem chama. O rollback tem
// pre-voo proprio e recusa estado desconhecido: isto nao afrouxa nada. So no Postgres EFEMERO (quem chama ja passou pela trava de
// efemero.cjs) e so no clone do rodar-isolado.cjs. No-op quando a 1661 nao esta no ar.

/* eslint-disable security/detect-non-literal-fs-filename -- caminhos fixos das migrations versionadas, sem entrada externa. */
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261661000000_a_loja_que_saiu_pausa_o_pedido_novo.sql";
const PASTA = path.resolve(__dirname, "..", "..", "supabase", "migrations");
const ler = (arq) =>
  fs.readFileSync(path.join(PASTA, arq), "utf8").replace(/\r\n/g, "\n");

/** A 1661 esta no ar se o motivo tem o corpo dela (md5 sem CR). */
const NO_AR = `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
    WHERE oid = to_regprocedure('public.motivo_da_loja_nao_aceitar_pedido()')) = 'f2404f96cd8a589f2821eb5c20a85aa2', false) AS sim`;

/** Desfaz a 1661 na transacao ja aberta por quem chama. Devolve true se desfez. */
async function desfazerASaidaNaTransacao(c) {
  if (!(await c.query(NO_AR)).rows[0].sim) return false;
  await c.query(ler(`rollback-manual-${NOME}`));
  return true;
}

/** Desfaz a 1661 numa transacao propria (COMMIT no clone). Devolve true se desfez. */
async function desfazerASaida(c) {
  await c.query("BEGIN");
  try {
    const desfez = await desfazerASaidaNaTransacao(c);
    await c.query("COMMIT");
    return desfez;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

const A_LOJA_QUE_SAIU = Object.freeze({ nome: NOME, noAr: NO_AR });

module.exports = {
  desfazerASaida,
  desfazerASaidaNaTransacao,
  A_LOJA_QUE_SAIU,
};
