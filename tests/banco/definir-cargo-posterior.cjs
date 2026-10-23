"use strict";
// A 20261383 (so o dono da loja define cargo) cria duas politicas de leitura (dono_da_loja_select_policy e
// cargo_log_select_policy) que citam rls_admin_atual(), criada pela 20261197000000: o rollback da 97 RECUSA
// (B1_BASELINE_DIVERGENT) enquanto qualquer politica fora dela ainda a usa. Esse comportamento e' o certo e nao e'
// afrouxado aqui. Toda prova viva que desfaz a 97 dentro da transacao tem de desfazer ANTES esta migration. O
// rollback-manual dela (o COMUM, nao o destrutivo) tira o gatilho, as duas funcoes e as duas politicas e DEIXA as tabelas
// com as linhas; recusa estado desconhecido, entao so roda se a migration estiver no ar. Entrada no formato { nome, noAr }
// das listas POSTERIORES_A_97.
const fs = require("node:fs");
const path = require("node:path");
const DEFINIR_CARGO = Object.freeze({
  nome: "20261383000000_so_o_dono_da_loja_define_cargo.sql",
  // "No ar" = a funcao que so a migration cria existe.
  noAr: "SELECT to_regprocedure('public.definir_cargo(uuid,text)') IS NOT NULL AS sim",
});
async function desfazerDefinirCargoNaTransacao(c) {
  if ((await c.query(DEFINIR_CARGO.noAr)).rows[0].sim) {
    const arquivo = path.join(
      __dirname,
      "../../supabase/migrations",
      `rollback-manual-${DEFINIR_CARGO.nome}`,
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- nome constante deste modulo.
    await c.query(fs.readFileSync(arquivo, "utf8"));
  }
}
module.exports = { DEFINIR_CARGO, desfazerDefinirCargoNaTransacao };
