"use strict";

/**
 * A 20261657000000 (o produto com todos os tamanhos desligados nao volta a venda sozinho) redefine DOIS corpos em cima dos da
 * 20261653000000: devolver_estoque e admin_devolucao_concluir (um sub-bloco marcado em cada). Nenhuma tabela nem funcao nova.
 *
 * Toda prova viva que mede a 20261653000000 (ou as antecessoras dela: 642, 389, 395, 343, 241, 175, 97) ISOLADA tem de desfazer
 * ANTES esta: o pre-voo do rollback da 20261653000000 recusa o corpo desta, e o comportamento medido seria o desta. O modulo
 * a-peca-da-variacao-desligada-posterior.cjs chama este primeiro, entao quem desfaz a 1653 (ou a 642) por ele ja desfaz esta junto.
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback devolve os dois corpos da 1653 byte a byte e nao apaga
 * nenhuma linha.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (o rollback do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261657000000_o_produto_todo_desligado_nao_volta_a_venda.sql";
const HASH_DEVOLVER_DESTA = "c98a1d49d63e0174f4bdd95dcffc54f4";
const HASH_CONCLUIR_DESTA = "b55bf2488a1d5165afddaa4d103d3e18";
const HASH_DEVOLVER_1653 = "2913f3178498938d0a79e3b47a1084d1";
const HASH_CONCLUIR_1653 = "d146dc7aefb07a0bf580ed7265d9453e";

const hashVivo = (assinatura) =>
  `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${assinatura}')`;
const DEVOLVER = "public.devolver_estoque(uuid)";
const CONCLUIR =
  "public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)";

// Formato { nome, noAr } das listas POSTERIORES_A_97: "no ar" = qualquer dos dois corpos e' o desta.
const PRODUTO_TODO_DESLIGADO = Object.freeze({
  nome: NOME,
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('${DEVOLVER}')) = '${HASH_DEVOLVER_DESTA}', false)
            OR COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('${CONCLUIR}')) = '${HASH_CONCLUIR_DESTA}', false) AS sim`,
});

/** Desfaz a 20261657000000 na conexao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerProdutoTodoDesligadoNaTransacao(cliente) {
  const r = await cliente.query(PRODUTO_TODO_DESLIGADO.noAr);
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
    HASH_DEVOLVER_1653,
    "a 20261657000000 nao restaurou devolver_estoque ao corpo da 20261653000000; revise as sucessoras",
  );
  assert.equal(
    (await cliente.query(hashVivo(CONCLUIR))).rows[0]?.h,
    HASH_CONCLUIR_1653,
    "a 20261657000000 nao restaurou admin_devolucao_concluir ao corpo da 20261653000000; revise as sucessoras",
  );
  return true;
}

module.exports = {
  PRODUTO_TODO_DESLIGADO,
  HASH_DEVOLVER_DESTA,
  HASH_CONCLUIR_DESTA,
  desfazerProdutoTodoDesligadoNaTransacao,
};
