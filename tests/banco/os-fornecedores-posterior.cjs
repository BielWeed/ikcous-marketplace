"use strict";
// A 20261450 (a loja guarda os fornecedores, e so o admin atual mexe) cria quatro politicas em public.fornecedores que citam
// rls_admin_atual(), criada pela 20261197000000: o rollback da 97 RECUSA (B1_BASELINE_DIVERGENT) enquanto qualquer politica
// fora dela ainda a usa. Esse comportamento e' o certo e nao e' afrouxado aqui. Toda prova viva que desfaz a 97 dentro da
// transacao tem de desfazer ANTES esta migration. O rollback-manual dela (o COMUM, nao o destrutivo) tira o gatilho, a funcao
// e as quatro politicas e DEIXA a tabela selada com as linhas; recusa estado desconhecido, entao so roda se a migration estiver
// no ar. Entrada no formato { nome, noAr } das listas POSTERIORES_A_97.
const fs = require("node:fs");
const path = require("node:path");
const FORNECEDORES = Object.freeze({
  nome: "20261450000000_a_loja_guarda_os_fornecedores.sql",
  // "No ar" = a funcao do gatilho, que so a migration cria, existe (o rollback comum a tira; depois dele nao ha o que desfazer).
  noAr: "SELECT to_regprocedure('public.fornecedores_carimba_atualizado_em()') IS NOT NULL AS sim",
});
async function desfazerFornecedoresNaTransacao(c) {
  if ((await c.query(FORNECEDORES.noAr)).rows[0].sim) {
    const arquivo = path.join(
      __dirname,
      "../../supabase/migrations",
      `rollback-manual-${FORNECEDORES.nome}`,
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- nome constante deste modulo.
    await c.query(fs.readFileSync(arquivo, "utf8"));
  }
}
module.exports = { FORNECEDORES, desfazerFornecedoresNaTransacao };
