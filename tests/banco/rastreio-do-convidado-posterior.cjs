"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos montados de literais do repositorio, nunca de entrada de rede. */

/**
 * As migrations 20261341000000 (o codigo do convidado trava a linha na tentativa) e 20261342000000 (o rastreio do
 * convidado nao devolve a nota do pedido) redefinem o corpo de public.get_orders_by_otp_v2(text,text,text,text) que a
 * 20261217000000 deixou. O pre-voo da 20261217000000 (e o do rollback dela) so aceita o corpo DA 1217 na v2, por
 * hash: com a 1341 ou a 1342 no ar eles recusam (B1_BASELINE_DIVERGENT). Esse e' o comportamento certo e nao e'
 * afrouxado: toda prova antiga que reaplica ou desfaz a 1217 dentro da transacao desfaz ANTES estas duas, na ordem
 * inversa da aplicacao (1342, depois 1341), pelos rollbacks-manuais delas (que devolvem o corpo anterior byte a byte).
 *
 * Somente nos clones efemeros: a funcao chama o rollback de verdade, na transacao do chamador (que termina em ROLLBACK
 * e devolve as duas ao ar).
 */

const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "..", "..", "supabase", "migrations");
const V2 = "public.get_orders_by_otp_v2(text,text,text,text)";

const M1217 = "53b5e632657b82206daa6aa992a50c0d";
const M1341 = "34199947ecded0fd9400b5fd0276ea47";
const M1342 = "02208ac9d2abe2e8b03790349d491ecb";

const ROLLBACK_1342 =
  "rollback-manual-20261342000000_o_rastreio_do_convidado_nao_devolve_a_nota_do_pedido.sql";
const ROLLBACK_1341 =
  "rollback-manual-20261341000000_o_codigo_do_convidado_trava_a_linha_na_tentativa.sql";

const md5Vivo = async (c) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [V2],
    )
  ).rows[0]?.h;

/**
 * Devolve a v2 ao corpo da 20261217000000 dentro da transacao do chamador. Devolve true se desfez alguma das duas,
 * false se a v2 ja estava com o corpo da 1217 (arvore sem a 1341). Corpo desconhecido: erro, nunca chute.
 */
async function desfazerRastreioDoConvidadoNaTransacao(c) {
  if (process.env.CI_BANCO_EFEMERO !== "1")
    throw new Error("Exige banco efemero");
  let h = await md5Vivo(c);
  let desfez = false;
  if (h === M1342) {
    await c.query(fs.readFileSync(path.join(DIR, ROLLBACK_1342), "utf8"));
    h = await md5Vivo(c);
    desfez = true;
  }
  if (h === M1341) {
    await c.query(fs.readFileSync(path.join(DIR, ROLLBACK_1341), "utf8"));
    h = await md5Vivo(c);
    desfez = true;
  }
  if (h !== M1217)
    throw new Error(
      `get_orders_by_otp_v2 com corpo inesperado (${h}) depois de desfazer o rastreio do convidado`,
    );
  return desfez;
}

module.exports = {
  desfazerRastreioDoConvidadoNaTransacao,
  CORPO_1217: M1217,
  CORPO_1341: M1341,
  CORPO_1342: M1342,
};
