"use strict";

/**
 * A 1664 muda o extrato (1391200), o saldo e as portas de conferência (241) e o ranking (1659).
 * As provas dos corpos anteriores a desfazem primeiro, só nos clones efêmeros.
 *
 * Toda prova viva que mede a 20261391200000 sobre a arvore ja migrada (o corpo exato, o rollback-manual dela, as consultas 100a/100b
 * no sentido "antes") tem de desfazer ANTES esta: o rollback-manual da 1391200 recusa (B1_BASELINE_DIVERGENT) com um corpo posterior
 * no ar. E' o comportamento CERTO (nunca restaurar por baixo de uma redefinicao posterior). A prova viva da 1391200
 * (o-financeiro-descreve-a-venda-do-balcao-viva.cjs) chama este modulo antes de medir.
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback nao muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (a migration do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261664000000_o_reembolso_por_fora_nao_conta_duas_vezes.sql";
const ASSINATURA = "public.fin__movimentos(date,date)";
// [hash da anterior (20261391200000), hash desta]
const CORPOS = Object.freeze([
  "26473edd94ad6547d95de43433088304",
  "17127ad84b6eb71e8cd1714d47855a68",
]);

const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${ASSINATURA}')`;

const O_REEMBOLSO_POR_FORA = Object.freeze({
  nome: NOME,
  assinatura: ASSINATURA,
  corpos: CORPOS,
});

/** Desfaz a 20261664000000 na transacao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerReembolsoPorForaNaTransacao(cliente) {
  const [anterior, desta] = CORPOS;
  if ((await cliente.query(hashVivo)).rows[0]?.h !== desta) return false;
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
    (await cliente.query(hashVivo)).rows[0]?.h,
    anterior,
    "a 20261664000000 nao restaurou fin__movimentos ao corpo da 20261391200000; revise as sucessoras",
  );
  return true;
}

async function desfazerReembolsoPorForaNoClone(cliente) {
  const db = (await cliente.query("SELECT current_database() AS nome")).rows[0]
    .nome;
  assert.ok(
    db.startsWith("prova_"),
    "use rodar-isolado.cjs: nunca mutar o banco base",
  );
  await cliente.query("BEGIN");
  try {
    await desfazerReembolsoPorForaNaTransacao(cliente);
    await cliente.query("COMMIT");
  } catch (erro) {
    await cliente.query("ROLLBACK");
    throw erro;
  }
}

module.exports = {
  desfazerReembolsoPorForaNoClone,
  O_REEMBOLSO_POR_FORA,
  desfazerReembolsoPorForaNaTransacao,
};
