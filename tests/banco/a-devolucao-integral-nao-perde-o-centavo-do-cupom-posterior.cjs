"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261405400000 (a devolução integral com cupom não perde o centavo) sucede, em UMA migration, a solicitar_devolucao da 20261399992000: o mesmo corpo
 * mais a troca que calcula o valor da linha pelo proporcional ACUMULADO (e não pelo preço de uma unidade arredondado vezes a quantidade).
 *
 * O rollback da 3992 recusa (B1_BASELINE_DIVERGENT) com o corpo novo de solicitar_devolucao no ar, e é o comportamento CERTO (nunca restaurar por baixo de uma
 * redefinição posterior). Então a prova que mede a 3992 sobre o estado dela tem de desfazer ESTA primeiro, na própria transação/clone:
 * `o-item-que-nao-veio-posterior.cjs` chama este módulo no início de `desfazerOItemQueNaoVeioNaTransacao` (que `portao-8e-aceita-sucessoras-viva.cjs` chama
 * em `noEstado`) e `sucessoras-da-99.cjs` a traz na lista, para cair antes da 3992. Nunca se afrouxa o pré-voo da migration anterior.
 *
 * Só nos clones efêmeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback não muda dado, assinatura nem ACL e devolve o corpo vigente de antes.
 */
const fs = require("node:fs");
const path = require("node:path");
const NOME =
  "20261405400000_a_devolucao_integral_nao_perde_o_centavo_do_cupom.sql";
const ASSINATURA =
  "public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])";
// [corpo vigente (o da 20261399992000), corpo desta migration] (md5 de replace(prosrc, E'\r', ''))
const CORPOS = Object.freeze([
  "52e5c30c06f9767a97e98f3a393b8496",
  "94ecd75ba32dd0a8ce7d433f4b6f7961",
]);
const A_DEVOLUCAO_INTEGRAL = Object.freeze({
  nome: NOME,
  assinatura: ASSINATURA,
  corpos: CORPOS,
});
const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`;

/** Desfaz a 20261405400000 na transação aberta, se o corpo dela está no ar; repetir é no-op. Devolve true se desfez. */
async function desfazerADevolucaoIntegralNaTransacao(c) {
  const [hashVigente, hashDesta] = CORPOS;
  if ((await c.query(hashVivo, [ASSINATURA])).rows[0]?.h !== hashDesta)
    return false;
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
  const h = (await c.query(hashVivo, [ASSINATURA])).rows[0]?.h;
  if (h !== hashVigente)
    throw new Error(
      `a 20261405400000 nao devolveu ${ASSINATURA} ao corpo vigente (${hashVigente}); vivo ${h}`,
    );
  return true;
}

module.exports = {
  A_DEVOLUCAO_INTEGRAL,
  desfazerADevolucaoIntegralNaTransacao,
};
