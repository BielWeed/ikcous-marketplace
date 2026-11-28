"use strict";

/**
 * A 20261660000000 (o caixa de ontem aberto nao some do saldo) redefine TRES funcoes: fin_conta_salvar em cima do corpo da
 * 20261399930000, fin_caixa_movimentar_com_chave em cima do da 20261654000000 e fin_lancamento_cancelar em cima do da
 * 20261199000000 (o mesmo corpo de cada uma; so as duas recusas e a trava da sessao entram).
 *
 * Toda prova viva que mede a 20261399930000, a 20261654000000 ou a 20261199000000 (ou a 8e, que trata fin_conta_salvar e
 * fin_lancamento_cancelar como funcoes da 99 com sucessoras) sobre a arvore ja migrada tem de desfazer ANTES esta: o rollback-manual
 * de cada uma delas recusa (B1_BASELINE_DIVERGENT) com um corpo posterior no ar. E' o comportamento CERTO (nunca restaurar por baixo
 * de uma redefinicao posterior). Os modulos o-caixa-pertence-ao-dia-posterior.cjs e o-caixa-e-a-conta-recusam-nan-posterior.cjs
 * chamam este primeiro; a cadeia da 99 (sucessoras-da-99.cjs) a desfaz pela ordem inversa da aplicacao.
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback nao muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (a migration do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261660000000_o_caixa_de_ontem_aberto_nao_some_do_saldo.sql";
// assinatura -> [hash da anterior, hash desta]
const CORPOS = Object.freeze({
  "public.fin_conta_salvar(jsonb)": [
    "1dc6cfdb075e3a1a0882398e1220d0f1",
    "d29894a41940ec4f5bc55ca2b103b69a",
  ],
  "public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)": [
    "f1b22fd85f7a4ae2200d37001c9e1ffb",
    "b7df8a8d11d64ab2cc2bd1dc31a57ae3",
  ],
  "public.fin_lancamento_cancelar(uuid,text)": [
    "a0b036d6d16d323dc806732b85b8b1cf",
    "ee75614cd65e5a7339045320e8a855c3",
  ],
});

const hashVivo = (assinatura) =>
  `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${assinatura}')`;

const O_CAIXA_DE_ONTEM_ABERTO = Object.freeze({ nome: NOME, corpos: CORPOS });

/** Desfaz a 20261660000000 na transacao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerCaixaDeOntemAbertoNaTransacao(cliente) {
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
      `a 20261660000000 nao restaurou ${assinatura} ao corpo anterior; revise as sucessoras`,
    );
  }
  return true;
}

module.exports = {
  O_CAIXA_DE_ONTEM_ABERTO,
  desfazerCaixaDeOntemAbertoNaTransacao,
};
