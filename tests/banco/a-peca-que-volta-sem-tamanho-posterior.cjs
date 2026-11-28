"use strict";

/**
 * A 20261642000000 (a peca que volta sem tamanho espera a lojista) redefine DOIS corpos em cima das sucessoras mais novas deles:
 * devolver_estoque (o da 20261389100000) e admin_devolucao_concluir (o da 20261395200000), e cria duas RPCs que chamam is_admin_atual().
 *
 * Toda prova viva que mede a 389, a 395 (ou as ancestrais delas: 343, 241, 175) ISOLADA, ou que desfaz a 20261197000000, tem de desfazer
 * ANTES esta: os pre-voos dos rollbacks da 389 e da 395 recusam o corpo desta ("sucessora no ar? nao desfaca por baixo dela") e o da 97
 * recusa funcao fora dela usando is_admin_atual. As duas coisas sao o comportamento CERTO.
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback devolve os dois corpos byte a byte, apaga as duas RPCs e
 * MANTEM a tabela pecas_sem_tamanho (nada que a 389, a 395 ou a 97 confiram).
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (o rollback do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261642000000_a_peca_que_volta_sem_tamanho_espera_a_lojista.sql";
const HASH_DEVOLVER_DESTA = "80b1a90baf10d1b4c59484772e4864c4";
const HASH_CONCLUIR_DESTA = "1a548896acb8248f1b1771d765c92fcb";
const HASH_DEVOLVER_389 = "943b226906e91013e7cccf4992617e35";
const HASH_CONCLUIR_395 = "a152c8dcd7cf6d1e05e5aff128d6c45e";

const hashVivo = (assinatura) =>
  `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${assinatura}')`;
const DEVOLVER = "public.devolver_estoque(uuid)";
const CONCLUIR =
  "public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)";

// Formato { nome, noAr } das listas POSTERIORES_A_97: "no ar" = qualquer dos dois corpos e' o desta, ou uma das RPCs dela existe.
const PECA_SEM_TAMANHO = Object.freeze({
  nome: NOME,
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('${DEVOLVER}')) = '${HASH_DEVOLVER_DESTA}', false)
            OR COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('${CONCLUIR}')) = '${HASH_CONCLUIR_DESTA}', false)
            OR to_regprocedure('public.resolver_peca_sem_tamanho(uuid,uuid)') IS NOT NULL
            OR to_regprocedure('public.pecas_sem_tamanho_pendentes(uuid)') IS NOT NULL AS sim`,
});

/** Desfaz a 20261642000000 na conexao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerPecaSemTamanhoNaTransacao(cliente) {
  // A 20261653000000 (a peca da variacao desligada) sucede os dois corpos desta: sai ANTES (o pre-voo do rollback desta recusa o
  // corpo dela). So se no ar; repetir e' no-op.
  await require("./a-peca-da-variacao-desligada-posterior.cjs").desfazerVariacaoDesligadaNaTransacao(
    cliente,
  );
  const r = await cliente.query(PECA_SEM_TAMANHO.noAr);
  if (r.rows[0]?.sim !== true) return false;
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
    (await cliente.query(hashVivo(DEVOLVER))).rows[0]?.h,
    HASH_DEVOLVER_389,
    "a 20261642000000 nao restaurou devolver_estoque ao corpo da 20261389100000; revise as sucessoras",
  );
  assert.equal(
    (await cliente.query(hashVivo(CONCLUIR))).rows[0]?.h,
    HASH_CONCLUIR_395,
    "a 20261642000000 nao restaurou admin_devolucao_concluir ao corpo da 20261395200000; revise as sucessoras",
  );
  return true;
}

module.exports = {
  PECA_SEM_TAMANHO,
  HASH_DEVOLVER_DESTA,
  HASH_CONCLUIR_DESTA,
  desfazerPecaSemTamanhoNaTransacao,
};
