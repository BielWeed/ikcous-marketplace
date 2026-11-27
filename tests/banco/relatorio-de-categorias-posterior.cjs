"use strict";

/* eslint-disable security/detect-non-literal-fs-filename -- O caminho do rollback vem do inventário de migrations do repositório. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SUCESSORAS_DA_99 } = require("./sucessoras-da-99.cjs");

const NOME_RELATORIO_DE_CATEGORIAS =
  "20261409000000_o_relatorio_de_categorias_nao_da_a_uma_categoria_o_dinheiro_de_item_sem_produto.sql";
// A 1620 sucede o corpo da 1409 (99 -> 409 -> 1620): o rollback da 1409 recusa com ela no ar.
const NOME_CATEGORIAS_NO_CENTAVO =
  "20261620000000_a_soma_das_categorias_fecha_com_o_faturamento_no_centavo.sql";
const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`;

/** Desfaz UMA sucessora pelo rollback-manual dela, só se o corpo dela estiver no ar. */
async function desfazerSeNoAr(c, nome) {
  const alvo = SUCESSORAS_DA_99.find((s) => s.nome === nome);
  assert.ok(alvo, `${nome} sumiu da lista de sucessoras da 99`);
  const lerHash = async () =>
    (await c.query(hashVivo, [alvo.assinatura])).rows[0]?.h;
  if ((await lerHash()) !== alvo.hashDesta) return false;
  await c.query(
    fs.readFileSync(
      path.join(__dirname, "..", "..", "supabase", "migrations", alvo.rollback),
      "utf8",
    ),
  );
  assert.equal(
    await lerHash(),
    alvo.hashVigente,
    `${alvo.rollback} não devolveu o corpo anterior`,
  );
  return true;
}

/** No clone efêmero, desfaz a 1620 (se no ar) e a 1409 na transação aberta e confere o corpo da 99. */
async function desfazerRelatorioDeCategoriasNaTransacao(c) {
  await desfazerSeNoAr(c, NOME_CATEGORIAS_NO_CENTAVO);
  return desfazerSeNoAr(c, NOME_RELATORIO_DE_CATEGORIAS);
}

module.exports = {
  NOME_RELATORIO_DE_CATEGORIAS,
  NOME_CATEGORIAS_NO_CENTAVO,
  desfazerRelatorioDeCategoriasNaTransacao,
};
