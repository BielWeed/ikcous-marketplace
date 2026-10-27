"use strict";

/**
 * A 20261395200000 (a conclusao da devolucao tranca o estoque na mesma ordem da compra) redefine admin_devolucao_concluir em cima do
 * corpo da 20261343000000: o mesmo corpo mais UM bloco de travas (entre os marcadores `ordem global das travas`) e duas variaveis.
 *
 * Toda prova viva que mede a 20261343000000 (ou a 20261241000000 e seus ancestrais) ISOLADA tem de desfazer ANTES esta: o pre-voo do
 * rollback da 343 recusa corpo de sucessora ("sucessora no ar? nao desfaca por baixo dela") e e' o comportamento CERTO.
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback nao muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (a migration do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME =
  "20261395200000_a_conclusao_da_devolucao_tranca_na_mesma_ordem_da_compra.sql";
const HASH_DESTA = "a152c8dcd7cf6d1e05e5aff128d6c45e";
const HASH_DA_343 = "ea651d52157521c0fe7ffccc948b4b1a";
const ASSINATURA =
  "public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)";

const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${ASSINATURA}')`;

// Formato { nome, noAr } das listas POSTERIORES_A_97: "no ar" = o corpo vivo e' exatamente o que esta migration deixa.
const CONCLUSAO_TRANCA = Object.freeze({
  nome: NOME,
  hashDesta: HASH_DESTA,
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('${ASSINATURA}')) = '${HASH_DESTA}', false) AS sim`,
});

/** Desfaz a 20261395200000 na conexao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerConclusaoTrancaNaTransacao(cliente) {
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
    HASH_DA_343,
    "a 20261395200000 nao restaurou admin_devolucao_concluir ao corpo da 20261343000000; revise as sucessoras",
  );
  return true;
}

module.exports = { CONCLUSAO_TRANCA, desfazerConclusaoTrancaNaTransacao };
