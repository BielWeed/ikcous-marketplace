"use strict";

/**
 * A 20261653000000 (a peca que volta para uma variacao desligada espera a lojista) redefine DOIS corpos em cima dos da
 * 20261642000000: devolver_estoque e admin_devolucao_concluir (um bloco marcado em cada), e cria UMA leitura nova,
 * pecas_sem_tamanho_da_devolucao(uuid) (a ficha da devolucao; chama is_admin_atual). Nenhuma tabela nova.
 *
 * Toda prova viva que mede a 20261642000000 (ou as antecessoras dela: 389, 395, 343, 241, 175, 97) ISOLADA tem de desfazer
 * ANTES esta: o pre-voo do rollback da 20261642000000 recusa o corpo desta ("sucessora no ar? nao desfaca por baixo dela"), e
 * o comportamento medido seria o desta. O modulo a-peca-que-volta-sem-tamanho-posterior.cjs chama este primeiro, entao quem
 * desfaz a 642 por ele ja desfaz esta junto.
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback devolve os dois corpos da 642 byte a byte, tira a
 * leitura nova e nao apaga nenhuma linha.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (o rollback do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261653000000_a_peca_da_variacao_desligada_espera_a_lojista.sql";
const HASH_DEVOLVER_DESTA = "2913f3178498938d0a79e3b47a1084d1";
const HASH_CONCLUIR_DESTA = "d146dc7aefb07a0bf580ed7265d9453e";
const HASH_DEVOLVER_642 = "80b1a90baf10d1b4c59484772e4864c4";
const HASH_CONCLUIR_642 = "1a548896acb8248f1b1771d765c92fcb";
const HASH_DA_DEVOLUCAO_DESTA = "a5514b503791af689ba68dfda6b76b6e";
const LEITURA = "public.pecas_sem_tamanho_da_devolucao(uuid)";

const hashVivo = (assinatura) =>
  `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${assinatura}')`;
const DEVOLVER = "public.devolver_estoque(uuid)";
const CONCLUIR =
  "public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)";

// Formato { nome, noAr } das listas POSTERIORES_A_97: "no ar" = qualquer dos dois corpos e' o desta, ou a leitura nova existe.
const VARIACAO_DESLIGADA = Object.freeze({
  nome: NOME,
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('${DEVOLVER}')) = '${HASH_DEVOLVER_DESTA}', false)
            OR COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('${CONCLUIR}')) = '${HASH_CONCLUIR_DESTA}', false)
            OR to_regprocedure('${LEITURA}') IS NOT NULL AS sim`,
});

/** Desfaz a 20261653000000 na conexao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerVariacaoDesligadaNaTransacao(cliente) {
  const r = await cliente.query(VARIACAO_DESLIGADA.noAr);
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
    HASH_DEVOLVER_642,
    "a 20261653000000 nao restaurou devolver_estoque ao corpo da 20261642000000; revise as sucessoras",
  );
  assert.equal(
    (await cliente.query(hashVivo(CONCLUIR))).rows[0]?.h,
    HASH_CONCLUIR_642,
    "a 20261653000000 nao restaurou admin_devolucao_concluir ao corpo da 20261642000000; revise as sucessoras",
  );
  assert.equal(
    (
      await cliente.query(
        `SELECT to_regprocedure('${LEITURA}') IS NULL AS saiu`,
      )
    ).rows[0]?.saiu,
    true,
    "a 20261653000000 nao tirou a leitura pecas_sem_tamanho_da_devolucao",
  );
  return true;
}

module.exports = {
  VARIACAO_DESLIGADA,
  HASH_DEVOLVER_DESTA,
  HASH_CONCLUIR_DESTA,
  HASH_DA_DEVOLUCAO_DESTA,
  desfazerVariacaoDesligadaNaTransacao,
};
