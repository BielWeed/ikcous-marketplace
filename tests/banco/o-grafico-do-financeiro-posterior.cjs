"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261399985000 (o gráfico do Financeiro soma só as contas ativas) sucede UMA função: o fin_resumo da 20261399300000, o mesmo corpo
 * mais a variação diária do saldo das contas ativas (a CTE `variacao` e a chave `serie[].variacao_saldo`).
 *
 * O rollback da 20261399300000 (e, por baixo dele, o da 20261199000000) recusa (B1_BASELINE_DIVERGENT) com o corpo novo no ar, e é o
 * comportamento CERTO (nunca restaurar por baixo de uma redefinição posterior). Então toda prova que desfaz ou mede uma delas isolada,
 * sobre a árvore já migrada, tem de desfazer ESTA primeiro, na própria transação/clone: `o-estorno-em-andamento-posterior.cjs` (que todo
 * consumidor da 3993 já chama) chama este módulo antes de desfazer a 3993. Nunca se afrouxa o pré-voo da migration anterior.
 *
 * Só nos clones efêmeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback não muda dado, assinatura nem ACL.
 */
const fs = require("node:fs");
const path = require("node:path");
const NOME =
  "20261399985000_o_grafico_do_financeiro_soma_so_as_contas_ativas.sql";
// md5 de replace(prosrc, E'\r', ''): o corpo vigente (o da 20261399300000) e o desta migration.
const GRAFICO_DO_FINANCEIRO = Object.freeze({
  nome: NOME,
  assinatura: "public.fin_resumo(date,date)",
  hashVigente: "a10e7f301eaf6b3edfac50bc87ff74bc",
  hashDesta: "9e711b03cc63f610461915b850f2eb70",
});
const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`;

/** Desfaz a 20261399985000 na transação aberta, se o fin_resumo está no corpo dela; repetir é no-op. Devolve true se desfez. */
async function desfazerGraficoDoFinanceiroNaTransacao(c) {
  const { assinatura, hashDesta, hashVigente } = GRAFICO_DO_FINANCEIRO;
  if ((await c.query(hashVivo, [assinatura])).rows[0]?.h !== hashDesta)
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
  const h = (await c.query(hashVivo, [assinatura])).rows[0]?.h;
  if (h !== hashVigente)
    throw new Error(
      `a 20261399985000 nao devolveu ${assinatura} ao corpo vigente (${hashVigente}); vivo ${h}`,
    );
  return true;
}

module.exports = {
  GRAFICO_DO_FINANCEIRO,
  desfazerGraficoDoFinanceiroNaTransacao,
};
