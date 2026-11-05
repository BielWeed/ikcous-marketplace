"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261398 sucede o painel_inicio da 20261390 (só a condição de receita_mes_anterior: o último dia dos mesmos dias do mês
 * anterior passa a contar até a MESMA hora de agora, e ganha a variável v_mes_ant_tem_o_dia). O rollback da 20261390 (e, por
 * baixo dele, o da 20261228) exige o corpo DELA: toda prova que desfaz ou mede a 20261390, a 20261228 ou a 20261212 isolada tem
 * de desfazer a 398 PRIMEIRO, na própria transação/clone, e só depois o-lucro-do-inicio-posterior.cjs (a 390). Nunca se afrouxa
 * o pré-voo da migration anterior.
 * A 20261399300000 (o estorno em andamento não é conta vencida) sucede ESTA em painel_inicio: `desfazerMesAnteriorNaTransacao` a desfaz antes
 * (o-estorno-em-andamento-posterior.cjs), de modo que todo consumidor que já a chama continua valendo com a 3993 no ar.
 */
const fs = require("node:fs");
const path = require("node:path");
const MES_ANTERIOR_ATE_A_MESMA_HORA = Object.freeze({
  nome: "20261398000000_o_inicio_compara_o_mes_anterior_ate_a_mesma_hora.sql",
  // "No ar" = o corpo vivo de painel_inicio é o desta migration (md5 do corpo sem CR).
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), ''))
    FROM pg_proc WHERE oid = to_regprocedure('public.painel_inicio()'))
    = '01d29aedf98b7f95851c1a1001b5c7ca', false) AS sim`,
});
async function desfazerMesAnteriorNaTransacao(c) {
  // A sucessora (3993) sai primeiro: o rollback da 398 só aceita o corpo da 398. Não faz nada se não está no ar.
  await require("./o-estorno-em-andamento-posterior.cjs").desfazerEstornoForaDoVencidoNaTransacao(
    c,
  );
  if ((await c.query(MES_ANTERIOR_ATE_A_MESMA_HORA.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${MES_ANTERIOR_ATE_A_MESMA_HORA.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = {
  MES_ANTERIOR_ATE_A_MESMA_HORA,
  desfazerMesAnteriorNaTransacao,
};
