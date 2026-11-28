"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261650000000 (a categoria que só tem produto excluído pode ser apagada) sucede o corpo de apagar_categoria_vazia
 * da 20261237000000 na MESMA assinatura (só a recusa por produto muda). As provas que medem o corpo e o comportamento
 * da 20261237000000 (categorias-gestao-viva.cjs e categorias-gestao-portao-viva.cjs: o excluído ainda segura a
 * categoria, o md5 vivo é o da 1237) têm de desfazer ESTA antes. O rollback-manual da 1237 é DROP IF EXISTS e não
 * precisa disto. O rollback-manual desta só devolve o corpo byte a byte; nenhuma linha muda.
 */
const fs = require("node:fs");
const path = require("node:path");
const CATEGORIA_SO_COM_EXCLUIDOS = Object.freeze({
  nome: "20261650000000_a_categoria_so_com_produto_excluido_pode_sair.sql",
  // "No ar" = o corpo vivo é exatamente o que esta migration deixa.
  noAr: `SELECT COALESCE(md5(replace(prosrc, E'\\r', '')) = 'f1526e7727709356677c83fdea745491', false) AS sim
           FROM pg_proc WHERE oid = to_regprocedure('public.apagar_categoria_vazia(uuid)')`,
});
/** Desfaz a 20261650000000 na transação aberta do cliente, se ela estiver no ar. Devolve true se desfez. */
async function desfazerCategoriaSoComExcluidosNaTransacao(c) {
  if ((await c.query(CATEGORIA_SO_COM_EXCLUIDOS.noAr)).rows[0]?.sim !== true)
    return false;
  await c.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${CATEGORIA_SO_COM_EXCLUIDOS.nome}`,
      ),
      "utf8",
    ),
  );
  return true;
}
module.exports = {
  CATEGORIA_SO_COM_EXCLUIDOS,
  desfazerCategoriaSoComExcluidosNaTransacao,
};
