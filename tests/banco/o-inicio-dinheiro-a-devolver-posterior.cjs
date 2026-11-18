"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261402000000 (o Início mostra o dinheiro a devolver e a margem do Financeiro) sucede UMA função: o painel_inicio da
 * 20261399300000, o mesmo corpo mais as chaves `dinheiro_a_devolver` e `mes.receita_liquida`.
 *
 * O rollback da 20261399300000 (e, por baixo dele, o da 20261398, o da 20261390, o da 20261228 e o da 20261212) recusa
 * (B1_BASELINE_DIVERGENT) com o corpo novo no ar, e é o comportamento CERTO (nunca restaurar por baixo de uma redefinição posterior).
 * Então toda prova que desfaz ou mede uma delas isolada, sobre a árvore já migrada, tem de desfazer ESTA primeiro, na própria
 * transação/clone: `o-estorno-em-andamento-posterior.cjs` (que todo consumidor da 3993 já chama) chama este módulo antes de desfazer a
 * 3993. Nunca se afrouxa o pré-voo da migration anterior.
 *
 * Só nos clones efêmeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback não muda dado, assinatura nem ACL.
 */
const fs = require("node:fs");
const path = require("node:path");
const NOME =
  "20261402000000_o_inicio_mostra_o_dinheiro_a_devolver_e_a_margem_do_financeiro.sql";
// md5 de replace(prosrc, E'\r', ''): o corpo vigente (o da 20261399300000) e o desta migration.
const INICIO_DINHEIRO_A_DEVOLVER = Object.freeze({
  nome: NOME,
  assinatura: "public.painel_inicio()",
  hashVigente: "8d58e15e7410afe0d254f37f38251df4",
  hashDesta: "b4c3665bd806ae8fe8960e5f6d9dde29",
});
const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`;

/** Desfaz a 20261402000000 na transação aberta, se o painel_inicio está no corpo dela; repetir é no-op. Devolve true se desfez. */
async function desfazerInicioDinheiroADevolverNaTransacao(c) {
  const { assinatura, hashDesta, hashVigente } = INICIO_DINHEIRO_A_DEVOLVER;
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
      `a 20261402000000 nao devolveu ${assinatura} ao corpo vigente (${hashVigente}); vivo ${h}`,
    );
  return true;
}

module.exports = {
  INICIO_DINHEIRO_A_DEVOLVER,
  desfazerInicioDinheiroADevolverNaTransacao,
};
