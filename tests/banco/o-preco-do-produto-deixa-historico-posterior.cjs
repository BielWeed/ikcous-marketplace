"use strict";
// A 20261386 (o preco do produto deixa historico) cria uma politica de leitura (produto_historico_preco_select_policy) que cita
// rls_admin_atual(), criada pela 20261197000000: o rollback da 97 RECUSA (B1_BASELINE_DIVERGENT) enquanto qualquer politica fora dela
// ainda a usa. Esse comportamento e' o certo e nao e' afrouxado aqui. Toda prova viva que desfaz a 97 dentro da transacao tem de
// desfazer ANTES esta migration. O rollback-manual dela (o COMUM, nao o destrutivo) tira o gatilho, a funcao e a politica e DEIXA a
// tabela com as linhas; so roda se a migration estiver no ar. Entrada no formato { nome, noAr } das listas POSTERIORES_A_97.
const fs = require("node:fs");
const path = require("node:path");
const PRECO_HISTORICO = Object.freeze({
  nome: "20261386000000_o_preco_do_produto_deixa_historico.sql",
  // "No ar" = a funcao do gatilho, que so a migration cria, existe.
  noAr: "SELECT to_regprocedure('public.registrar_historico_de_preco()') IS NOT NULL AS sim",
});
async function desfazerPrecoHistoricoNaTransacao(c) {
  if ((await c.query(PRECO_HISTORICO.noAr)).rows[0].sim) {
    const arquivo = path.join(
      __dirname,
      "../../supabase/migrations",
      `rollback-manual-${PRECO_HISTORICO.nome}`,
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- nome constante deste modulo.
    await c.query(fs.readFileSync(arquivo, "utf8"));
  }
}
module.exports = { PRECO_HISTORICO, desfazerPrecoHistoricoNaTransacao };
