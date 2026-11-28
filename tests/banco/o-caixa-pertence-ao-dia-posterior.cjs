"use strict";

/**
 * A 20261654000000 (o caixa pertence ao dia em que abriu) redefine QUATRO funcoes: fin_lancamento_salvar em cima do corpo da
 * 20261246000000, fin_lancamento_baixar em cima do da 20261199000000, e fin_caixa_fechar_sessao e fin_caixa_movimentar_com_chave em
 * cima dos da 20261252000000 (o mesmo corpo de cada uma; so a escolha da sessao e a data gravada pela sessao mudam).
 *
 * Toda prova viva que mede a 20261246000000, a 20261252000000 ou a 20261199000000 (ou a 8e, que trata fin_lancamento_salvar e
 * fin_lancamento_baixar como funcoes da 99 com sucessoras) sobre a arvore ja migrada tem de desfazer ANTES esta: o rollback-manual da
 * 246 e o da 252 recusam (B1_BASELINE_DIVERGENT) com um corpo posterior no ar. E' o comportamento CERTO (nunca restaurar por baixo de
 * uma redefinicao posterior).
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback nao muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (a migration do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261654000000_o_caixa_pertence_ao_dia_em_que_abriu.sql";
// assinatura -> [hash da anterior, hash desta]
const CORPOS = Object.freeze({
  "public.fin_lancamento_salvar(jsonb)": [
    "1356dbfc037a9202ef163ba598854891",
    "3e31817ce1d13bb091ce2d0871cbd718",
  ],
  "public.fin_lancamento_baixar(uuid,date,uuid)": [
    "e59bc12ea20182da4209a257df0be8c1",
    "7d1204cdf214a290cfdb378482795f1b",
  ],
  "public.fin_caixa_fechar_sessao(uuid,numeric,text)": [
    "f10208ba223450fd25af3c9e11dca073",
    "3bc5c509d150fca3c5135361461dcc40",
  ],
  "public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)": [
    "134bd5b7c5872bf30041601725fc37ba",
    "f1b22fd85f7a4ae2200d37001c9e1ffb",
  ],
});

const hashVivo = (assinatura) =>
  `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${assinatura}')`;

const O_CAIXA_PERTENCE_AO_DIA = Object.freeze({ nome: NOME, corpos: CORPOS });

/** Desfaz a 20261654000000 na transacao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerCaixaDoDiaDaAberturaNaTransacao(cliente) {
  let noAr = false;
  for (const [assinatura, [, desta]] of Object.entries(CORPOS)) {
    if ((await cliente.query(hashVivo(assinatura))).rows[0]?.h === desta)
      noAr = true;
  }
  if (!noAr) return false;
  await cliente.query(
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
  for (const [assinatura, [anterior]] of Object.entries(CORPOS)) {
    assert.equal(
      (await cliente.query(hashVivo(assinatura))).rows[0]?.h,
      anterior,
      `a 20261654000000 nao restaurou ${assinatura} ao corpo anterior; revise as sucessoras`,
    );
  }
  return true;
}

module.exports = {
  O_CAIXA_PERTENCE_AO_DIA,
  desfazerCaixaDoDiaDaAberturaNaTransacao,
};
