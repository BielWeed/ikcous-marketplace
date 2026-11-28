"use strict";

/**
 * A 20261663000000 (a despesa nao entra no caixa fechado) redefine DUAS funcoes em cima dos corpos da 20261654000000:
 * fin_lancamento_salvar e fin_lancamento_baixar (o mesmo corpo de cada uma; so a leitura da sessao aberta passa a travar a linha).
 *
 * Toda prova viva que mede a 20261654000000 (ou a 246/99 por baixo dela, ou a 8e, que trata as duas como funcoes da 99 com
 * sucessoras) sobre a arvore ja migrada tem de desfazer ANTES esta: o rollback-manual da 1654 recusa (B1_BASELINE_DIVERGENT) com um
 * corpo posterior no ar. E' o comportamento CERTO (nunca restaurar por baixo de uma redefinicao posterior). O modulo
 * o-caixa-pertence-ao-dia-posterior.cjs chama este primeiro; a cadeia da 99 (sucessoras-da-99.cjs) a desfaz pela ordem inversa da
 * aplicacao.
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback nao muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (a migration do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261663000000_a_despesa_nao_entra_no_caixa_fechado.sql";
// assinatura -> [hash da anterior, hash desta]
const CORPOS = Object.freeze({
  "public.fin_lancamento_salvar(jsonb)": [
    "3e31817ce1d13bb091ce2d0871cbd718",
    "729fc6e3e4a643459df835d214fa082e",
  ],
  "public.fin_lancamento_baixar(uuid,date,uuid)": [
    "7d1204cdf214a290cfdb378482795f1b",
    "0abf8da5b460d8b8236ffb5ffc111524",
  ],
});

const hashVivo = (assinatura) =>
  `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${assinatura}')`;

const A_DESPESA_NAO_ENTRA_NO_CAIXA_FECHADO = Object.freeze({
  nome: NOME,
  corpos: CORPOS,
});

/** Desfaz a 20261663000000 na transacao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerDespesaNoCaixaFechadoNaTransacao(cliente) {
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
      `a 20261663000000 nao restaurou ${assinatura} ao corpo anterior; revise as sucessoras`,
    );
  }
  return true;
}

module.exports = {
  A_DESPESA_NAO_ENTRA_NO_CAIXA_FECHADO,
  desfazerDespesaNoCaixaFechadoNaTransacao,
};
