"use strict";

/* eslint-disable security/detect-non-literal-fs-filename -- O caminho do rollback vem do inventário de migrations do repositório. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SUCESSORAS_DA_99 } = require("./sucessoras-da-99.cjs");

const NOME_RELATORIO_DE_CATEGORIAS =
  "20261409000000_o_relatorio_de_categorias_nao_da_a_uma_categoria_o_dinheiro_de_item_sem_produto.sql";
const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`;

/** No clone efêmero, desfaz a 1409 na transação aberta e confere o corpo da 99. */
async function desfazerRelatorioDeCategoriasNaTransacao(c) {
  const alvo = SUCESSORAS_DA_99.find(
    (s) => s.nome === NOME_RELATORIO_DE_CATEGORIAS,
  );
  assert.ok(alvo, "a 1409 sumiu da lista de sucessoras da 99");
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
    `${alvo.rollback} não devolveu o corpo da 99`,
  );
  return true;
}

module.exports = {
  NOME_RELATORIO_DE_CATEGORIAS,
  desfazerRelatorioDeCategoriasNaTransacao,
};
