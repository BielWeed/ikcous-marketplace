"use strict";

/**
 * A 20261659000000 (a peca de produto excluido fica fora do estoque, e o vale-troca nao e dinheiro no ranking de lucro) redefine
 * QUATRO corpos: devolver_estoque e admin_devolucao_concluir (em cima dos da 20261653000000), resolver_peca_sem_tamanho (em cima do da
 * 20261642000000) e get_admin_analytics_v2 (em cima do da 20261399995000). Nenhum objeto novo, nenhuma tabela.
 *
 * Toda prova viva que mede a 20261653000000, a 20261642000000 ou a 20261399995000 (ou as antecessoras delas) ISOLADA tem de desfazer
 * ANTES esta: os pre-voos dos rollbacks delas recusam o corpo desta ("sucessora no ar? nao desfaca por baixo dela"), e o comportamento
 * medido seria o desta. Quem chama este modulo primeiro: a-peca-da-variacao-desligada-posterior.cjs (a cadeia do estoque: 653 -> 642 ->
 * ...) e o-lucro-do-ranking-casa-com-o-financeiro-posterior.cjs (a cadeia do lucro: 3995 -> 3994 -> ...), e as provas vivas da 653 e
 * da 3995 no comeco.
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback devolve os quatro corpos byte a byte e nao apaga nenhuma
 * linha.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (o rollback do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME =
  "20261659000000_a_peca_de_produto_excluido_fica_fora_e_o_vale_nao_e_dinheiro.sql";
const HASH_DEVOLVER_DESTA = "a2b4e093b3afee7b5f641a8dda2692c4";
const HASH_CONCLUIR_DESTA = "b0373391f4d900670f01188103928e07";
const HASH_RESOLVER_DESTA = "115378a67cd4f89b73129aeec4c46a7f";
const HASH_ANALYTICS_DESTA = "1624212a7096b6f49a80370b30191a15";
const HASH_DEVOLVER_653 = "2913f3178498938d0a79e3b47a1084d1";
const HASH_CONCLUIR_653 = "d146dc7aefb07a0bf580ed7265d9453e";
const HASH_RESOLVER_642 = "cac3d04d9be77c7d4004003bb70561c5";
const HASH_ANALYTICS_3995 = "4f8fb94f6cb0018e10d0ef71541f1cbf";

const DEVOLVER = "public.devolver_estoque(uuid)";
const CONCLUIR =
  "public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)";
const RESOLVER = "public.resolver_peca_sem_tamanho(uuid,uuid)";
const ANALYTICS = "public.get_admin_analytics_v2(integer)";

const hashVivo = (assinatura) =>
  `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${assinatura}')`;
const eDesta = (assinatura, hash) =>
  `COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('${assinatura}')) = '${hash}', false)`;

// Formato { nome, noAr } das listas POSTERIORES_A_97: "no ar" = qualquer dos quatro corpos e' o desta.
const PRODUTO_EXCLUIDO = Object.freeze({
  nome: NOME,
  noAr: `SELECT ${eDesta(DEVOLVER, HASH_DEVOLVER_DESTA)}
            OR ${eDesta(CONCLUIR, HASH_CONCLUIR_DESTA)}
            OR ${eDesta(RESOLVER, HASH_RESOLVER_DESTA)}
            OR ${eDesta(ANALYTICS, HASH_ANALYTICS_DESTA)} AS sim`,
});

/** Desfaz a 20261659000000 na conexao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerProdutoExcluidoNaTransacao(cliente) {
  const r = await cliente.query(PRODUTO_EXCLUIDO.noAr);
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
  for (const [assinatura, hash, de] of [
    [DEVOLVER, HASH_DEVOLVER_653, "20261653000000"],
    [CONCLUIR, HASH_CONCLUIR_653, "20261653000000"],
    [RESOLVER, HASH_RESOLVER_642, "20261642000000"],
    [ANALYTICS, HASH_ANALYTICS_3995, "20261399995000"],
  ])
    assert.equal(
      (await cliente.query(hashVivo(assinatura))).rows[0]?.h,
      hash,
      `a 20261659000000 nao restaurou ${assinatura} ao corpo da ${de}; revise as sucessoras`,
    );
  return true;
}

module.exports = {
  PRODUTO_EXCLUIDO,
  HASH_DEVOLVER_DESTA,
  HASH_CONCLUIR_DESTA,
  HASH_RESOLVER_DESTA,
  HASH_ANALYTICS_DESTA,
  HASH_DEVOLVER_653,
  HASH_CONCLUIR_653,
  HASH_RESOLVER_642,
  HASH_ANALYTICS_3995,
  desfazerProdutoExcluidoNaTransacao,
};
