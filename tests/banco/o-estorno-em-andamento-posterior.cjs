"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261399300000 sucede DUAS funções: o painel_inicio da 20261398 (só o `contas_vencidas`) e o fin_resumo da 20261199 (só o
 * `a_pagar.vencido`). O rollback da 20261398 (e, por baixo dele, o da 20261390, o da 20261228 e o da 20261212) e o da 20261199
 * exigem o corpo DELES: toda prova que desfaz ou mede essas migrations isoladas tem de desfazer a 3993 PRIMEIRO, na própria
 * transação/clone. Quem já chama `desfazerMesAnteriorNaTransacao` (o-inicio-compara-o-mes-anterior-posterior.cjs) recebe isto de
 * graça: aquele módulo chama este antes de desfazer a 398. O rollback da 3993 desfaz as duas funções de uma vez.
 * Nunca se afrouxa o pré-voo da migration anterior.
 */
const fs = require("node:fs");
const path = require("node:path");
const ESTORNO_FORA_DO_VENCIDO = Object.freeze({
  nome: "20261399300000_o_estorno_em_andamento_nao_e_conta_vencida.sql",
  // "No ar" = o corpo vivo de painel_inicio é o desta migration (md5 do corpo sem CR); o de fin_resumo vai junto (o rollback exige os dois).
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.painel_inicio()'))
    = '8d58e15e7410afe0d254f37f38251df4', false) AS sim`,
});
async function desfazerEstornoForaDoVencidoNaTransacao(c) {
  if ((await c.query(ESTORNO_FORA_DO_VENCIDO.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${ESTORNO_FORA_DO_VENCIDO.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = {
  ESTORNO_FORA_DO_VENCIDO,
  desfazerEstornoForaDoVencidoNaTransacao,
};
