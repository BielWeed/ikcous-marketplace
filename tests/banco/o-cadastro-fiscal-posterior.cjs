"use strict";
// A 20261440 (a loja guarda o cadastro fiscal, e so o dono altera) cria uma funcao (fiscal_cadastro_salvar, que chama
// is_admin_atual()) e duas politicas de leitura (fiscal_cadastro_select_policy e fiscal_cadastro_log_select_policy, que citam
// rls_admin_atual()), criadas pela 20261197000000: o rollback da 97 RECUSA (B1_BASELINE_DIVERGENT) enquanto qualquer funcao ou
// politica fora dela ainda as usa. Esse comportamento e' o certo e nao e' afrouxado aqui. Toda prova viva que desfaz a 97 dentro
// da transacao tem de desfazer ANTES esta migration. O rollback-manual dela (o COMUM, nao o destrutivo) tira a funcao e as duas
// politicas e DEIXA as tabelas com as linhas; recusa estado desconhecido, entao so roda se a migration estiver no ar. Entrada
// no formato { nome, noAr } das listas POSTERIORES_A_97.
const fs = require("node:fs");
const path = require("node:path");
const CADASTRO_FISCAL = Object.freeze({
  nome: "20261440000000_a_loja_guarda_o_cadastro_fiscal.sql",
  // "No ar" = a funcao que so a migration cria existe.
  noAr: "SELECT to_regprocedure('public.fiscal_cadastro_salvar(jsonb)') IS NOT NULL AS sim",
});
async function desfazerCadastroFiscalNaTransacao(c) {
  if ((await c.query(CADASTRO_FISCAL.noAr)).rows[0].sim) {
    const arquivo = path.join(
      __dirname,
      "../../supabase/migrations",
      `rollback-manual-${CADASTRO_FISCAL.nome}`,
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- nome constante deste modulo.
    await c.query(fs.readFileSync(arquivo, "utf8"));
  }
}
module.exports = { CADASTRO_FISCAL, desfazerCadastroFiscalNaTransacao };
