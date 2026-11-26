"use strict";
// A 20261510 (o livro de registro guarda a versao antiga) poe DOIS gatilhos (tr_livro_alteracao, tr_livro_exclusao) em 17 tabelas de
// dinheiro, entre elas public.fornecedores. O pre-voo e o pos-voo da 20261450 (os fornecedores) exigem EXATAMENTE um gatilho na tabela
// (fornecedores_carimba_atualizado_em): esse comportamento e' o certo para a 20261450 e nao e' afrouxado aqui. Toda prova viva que
// REAPLICA a 20261450 (ou fotografa os gatilhos de public.fornecedores esperando so o dela) tira o livro ANTES, no clone exclusivo.
// O rollback-manual comum do livro tira os 34 gatilhos, a funcao que anota e o job, e PRESERVA as tabelas; recusa estado desconhecido,
// entao so roda se o livro estiver no ar. Entrada no formato { nome, noAr } das listas de posteriores.
const fs = require("node:fs");
const path = require("node:path");
const LIVRO_DE_REGISTRO = Object.freeze({
  nome: "20261510000000_o_livro_de_registro_guarda_a_versao_antiga.sql",
  // "No ar" = a funcao dos gatilhos, que so a migration cria, existe (o rollback comum a tira; depois dele nao ha o que desfazer).
  noAr: "SELECT to_regprocedure('public.livro_de_registro_anotar()') IS NOT NULL AS sim",
});
/** Roda o rollback comum do livro DENTRO da transacao do chamador (so se o livro estiver no ar). */
async function desfazerLivroNaTransacao(c) {
  if ((await c.query(LIVRO_DE_REGISTRO.noAr)).rows[0].sim) {
    const arquivo = path.join(
      __dirname,
      "../../supabase/migrations",
      `rollback-manual-${LIVRO_DE_REGISTRO.nome}`,
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- nome constante deste modulo.
    await c.query(fs.readFileSync(arquivo, "utf8"));
  }
}
/** Tira o livro do clone (GRAVADO, numa transacao propria): para provas que reaplicam migrations antigas fora de transacao. */
async function tirarOLivroDoClone(c) {
  await c.query("BEGIN");
  try {
    await desfazerLivroNaTransacao(c);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
module.exports = {
  LIVRO_DE_REGISTRO,
  desfazerLivroNaTransacao,
  tirarOLivroDoClone,
};
