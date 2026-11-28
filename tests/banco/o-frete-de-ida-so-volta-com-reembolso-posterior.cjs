"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261658000000 (o frete de ida só volta com reembolso) sucede, em UMA migration, a solicitar_devolucao da 20261405400000 e a
 * devolucao_elegibilidade da 20261399992000: o mesmo corpo de cada uma mais a conta do frete de ida que só olha a devolução atual e as
 * concluídas com reembolso (e, na elegibilidade, o campo ja_reembolsada).
 *
 * O rollback da 5400 e o da 3992 recusam (B1_BASELINE_DIVERGENT) com o corpo novo no ar, e é o comportamento CERTO (nunca restaurar por
 * baixo de uma redefinição posterior). Então a prova que mede a 5400 ou a 3992 sobre o estado delas tem de desfazer ESTA primeiro, na
 * própria transação/clone: `a-devolucao-integral-nao-perde-o-centavo-do-cupom-posterior.cjs` chama este módulo no início de
 * `desfazerADevolucaoIntegralNaTransacao` (que `o-item-que-nao-veio-posterior.cjs` chama) e `sucessoras-da-99.cjs` a traz na lista,
 * para cair antes das duas. Nunca se afrouxa o pré-voo da migration anterior.
 *
 * Só nos clones efêmeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback não muda dado, assinatura nem ACL e desfaz as DUAS de uma
 * vez (estado misto recusa sem escrever).
 */
const fs = require("node:fs");
const path = require("node:path");
const NOME = "20261658000000_o_frete_de_ida_so_volta_com_reembolso.sql";
// assinatura -> [corpo vigente (o da migration anterior), corpo desta migration] (md5 de replace(prosrc, E'\r', ''))
const CORPOS = Object.freeze({
  "public.devolucao_elegibilidade(uuid)": [
    "bedd211bba45261dfbf962241ca3c9dd",
    "4776618e9ccd401f7c7eb9518ceaa62d",
  ],
  "public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])": [
    "94ecd75ba32dd0a8ce7d433f4b6f7961",
    "e3f83a07f0a4909fb879ac653c115871",
  ],
});
const O_FRETE_DE_IDA = Object.freeze({ nome: NOME, corpos: CORPOS });
const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`;

/** Desfaz a 20261658000000 na transação aberta, se ALGUMA das duas funções está no corpo dela; repetir é no-op. Devolve true se desfez. */
async function desfazerOFreteDeIdaNaTransacao(c) {
  let noAr = false;
  for (const [assinatura, [, hashDesta]] of Object.entries(CORPOS))
    if ((await c.query(hashVivo, [assinatura])).rows[0]?.h === hashDesta)
      noAr = true;
  if (!noAr) return false;
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
  for (const [assinatura, [hashVigente]] of Object.entries(CORPOS)) {
    const h = (await c.query(hashVivo, [assinatura])).rows[0]?.h;
    if (h !== hashVigente)
      throw new Error(
        `a 20261658000000 nao devolveu ${assinatura} ao corpo vigente (${hashVigente}); vivo ${h}`,
      );
  }
  return true;
}

module.exports = { O_FRETE_DE_IDA, desfazerOFreteDeIdaNaTransacao };
