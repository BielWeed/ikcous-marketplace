"use strict";
// A 20261381 (o ex-admin perde o acesso na hora no resto do painel) faz 21 politicas e 10 RPCs citarem rls_admin_atual() /
// is_admin_atual(), criadas pela 20261197000000: o rollback da 97 RECUSA (B1_BASELINE_DIVERGENT) enquanto qualquer
// politica ou funcao fora dela ainda as usa. Esse comportamento e' o certo e nao e' afrouxado aqui. Toda prova viva que
// desfaz a 97 dentro da transacao tem de desfazer ANTES esta migration. O rollback-manual dela devolve as 21 expressoes,
// apaga a politica nova de banners e devolve os 10 corpos (nenhum dado muda); recusa estado desconhecido, entao so roda
// se a migration estiver no ar. Entrada no formato { nome, noAr } das listas POSTERIORES_A_97.
const fs = require("node:fs");
const path = require("node:path");
const EX_ADMIN_RESTO_DO_PAINEL = Object.freeze({
  nome: "20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql",
  // "No ar" = a politica nova de leitura do admin em banners existe (so a migration a cria).
  noAr: "SELECT EXISTS(SELECT 1 FROM pg_policy WHERE polname='banners_admin_select_policy' AND polrelid=to_regclass('public.banners')) sim",
});
async function desfazerExAdminRestoNaTransacao(c) {
  // A 20261385 (a busca de produtos acha o codigo de barras) sucede get_admin_products_paged desta: o rollback da 81 exige o
  // corpo DELA, entao a 385 sai antes (nao faz nada se nao esta no ar). Os 6 chamadores deste modulo herdam a ordem.
  await require("./busca-do-painel-por-codigo-posterior.cjs").desfazerBuscaDoPainelNaTransacao(
    c,
  );
  if ((await c.query(EX_ADMIN_RESTO_DO_PAINEL.noAr)).rows[0].sim) {
    const arquivo = path.join(
      __dirname,
      "../../supabase/migrations",
      `rollback-manual-${EX_ADMIN_RESTO_DO_PAINEL.nome}`,
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- nome constante deste modulo.
    await c.query(fs.readFileSync(arquivo, "utf8"));
  }
}
module.exports = { EX_ADMIN_RESTO_DO_PAINEL, desfazerExAdminRestoNaTransacao };
