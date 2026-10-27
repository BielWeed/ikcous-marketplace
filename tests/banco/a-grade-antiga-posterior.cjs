"use strict";

/**
 * A 20261395100000 (a grade antiga nao ressuscita variacao excluida) redefine salvar_produto_com_grade em cima do corpo da
 * 20261352000000: o mesmo corpo mais UM `CONTINUE` (com 4 linhas de comentario) dentro do laco das variacoes.
 *
 * Toda prova viva que mede a 20261352000000 ISOLADA (reaplicar a migration, o hash do corpo, o rollback) tem de desfazer ANTES
 * esta: o pre-voo da 352 recusa corpo de sucessora ("sucessora no ar? nao reaplique por cima") e e' o comportamento CERTO
 * (nunca restaurar por baixo de uma redefinicao posterior).
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback nao muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (a migration do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME =
  "20261395100000_a_grade_antiga_nao_ressuscita_variacao_excluida.sql";
const HASH_DESTA = "10fc8c0f1e305666b39e5f1f383815e2";
const HASH_DA_352 = "09c2a4b5724acbe46fb2c2e758e96c8f";
const ASSINATURA =
  "public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])";

const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${ASSINATURA}')`;

const GRADE_ANTIGA = Object.freeze({ nome: NOME, hashDesta: HASH_DESTA });

/** Desfaz a 20261395100000 na conexao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerGradeAntigaNaTransacao(cliente) {
  const r = await cliente.query(hashVivo);
  if (r.rows[0]?.h !== HASH_DESTA) return false;
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
    HASH_DA_352,
    "a 20261395100000 nao restaurou salvar_produto_com_grade ao corpo da 20261352000000; revise as sucessoras",
  );
  return true;
}

module.exports = { GRADE_ANTIGA, desfazerGradeAntigaNaTransacao };
