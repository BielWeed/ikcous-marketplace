"use strict";

/**
 * A 20261399930000 (o caixa e a conta recusam valor que nao e numero) redefine DUAS funcoes: fin_caixa_abrir em cima do corpo da 20261370000000 e
 * fin_conta_salvar em cima do da 20261199000000 (o mesmo corpo de cada uma mais UMA guarda de NaN/infinito/acima do teto).
 *
 * Toda prova viva que mede a 20261370000000 (o corpo de fin_caixa_abrir da 370) ou a 20261199000000 (ou a 8e, que trata fin_caixa_abrir e fin_conta_salvar
 * como funcoes da 99 com sucessoras) sobre a arvore ja migrada tem de desfazer ANTES esta: o rollback-manual da 20261370000000 recusa
 * (B1_BASELINE_DIVERGENT) com um corpo posterior no ar. E' o comportamento CERTO (nunca restaurar por baixo de uma redefinicao posterior).
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback nao muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (a migration do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME =
  "20261399930000_o_caixa_e_a_conta_recusam_valor_que_nao_e_numero.sql";
const HASH_ABRIR_DESTA = "367d298dcc78bc2829fc4e0048005a0c";
const HASH_ABRIR_DA_370 = "28ab512e291378a01d110e298af7a402";
const HASH_CONTA_DESTA = "1dc6cfdb075e3a1a0882398e1220d0f1";
const HASH_CONTA_DA_99 = "2f9b720cb3804edba4879595b0d6fe1d";
const ABRIR = "public.fin_caixa_abrir(numeric,uuid)";
const CONTA = "public.fin_conta_salvar(jsonb)";

const hashVivo = (assinatura) =>
  `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${assinatura}')`;

const CAIXA_E_CONTA_SEM_NAN = Object.freeze({
  nome: NOME,
  hashAbrirDesta: HASH_ABRIR_DESTA,
  hashContaDesta: HASH_CONTA_DESTA,
});

/** Desfaz a 20261399930000 na transacao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerCaixaEContaSemNanNaTransacao(cliente) {
  const abrir = (await cliente.query(hashVivo(ABRIR))).rows[0]?.h;
  const conta = (await cliente.query(hashVivo(CONTA))).rows[0]?.h;
  if (abrir !== HASH_ABRIR_DESTA && conta !== HASH_CONTA_DESTA) return false;
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
  assert.equal(
    (await cliente.query(hashVivo(ABRIR))).rows[0]?.h,
    HASH_ABRIR_DA_370,
    "a 20261399930000 nao restaurou fin_caixa_abrir ao corpo da 20261370000000; revise as sucessoras",
  );
  assert.equal(
    (await cliente.query(hashVivo(CONTA))).rows[0]?.h,
    HASH_CONTA_DA_99,
    "a 20261399930000 nao restaurou fin_conta_salvar ao corpo da 20261199000000; revise as sucessoras",
  );
  return true;
}

module.exports = {
  CAIXA_E_CONTA_SEM_NAN,
  desfazerCaixaEContaSemNanNaTransacao,
};
