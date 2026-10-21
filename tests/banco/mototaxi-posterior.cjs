"use strict";

/**
 * A migration 20261330000000 (contato do mototaxi privado; 21/10/2026) cria DUAS coisas que citam as portas da
 * 20261197000000 de PROPOSITO: a funcao public.salvar_config_mototaxi(text, text) (SECURITY DEFINER, so admin: usa
 * is_admin() e is_admin_atual()) e a politica config_mototaxi_admin_select (rls_admin_atual()).
 *
 * O rollback da 97 apaga is_admin_atual() e rls_admin_atual() e, por isso, RECUSA (B1_BASELINE_DIVERGENT) enquanto
 * qualquer funcao ou politica fora da 97 ainda as usa. Esse e o comportamento CERTO (nunca deixar o painel chamando
 * funcao inexistente) e nao e afrouxado aqui. Toda prova viva que desfaz a 97 dentro da transacao (ou mede a 95
 * isolada) tem de desfazer ANTES as posteriores que dependem dela; este modulo e a entrada unica da mototaxi, no
 * formato { nome, noAr } das listas POSTERIORES_A_97, com o gancho `depois`.
 *
 * ATENCAO, o que o rollback-manual da 1330 NAO faz (de proposito do autor dela: "reverter o front primeiro, a funcao
 * nova permanece inerte, preserva tabela e contato"): ele so REVOGA os acessos; nao apaga a funcao nem a politica. Com
 * os dois ainda no ar o rollback da 97 continua recusando. Por isso o gancho `depois` apaga SO a funcao e a politica
 * (nunca a tabela nem o contato), DENTRO da transacao da prova, que e desfeita no ROLLBACK do fim. Em producao a mesma
 * lacuna existe: quem for reverter a 97 depois de reverter a 1330 tem de apagar a funcao e a politica antes.
 *
 * Idempotente: DROP ... IF EXISTS.
 */

const NOME_MOTOTAXI = "20261330000000_mototaxi_privado.sql";
const NO_AR = `SELECT to_regprocedure('public.salvar_config_mototaxi(text,text)') IS NOT NULL AS sim`;

/** Apaga so a funcao e a politica que o rollback da 1330 deixa inertes. Nao toca a tabela nem o contato. */
async function apagarResiduoDoMototaxiNaTransacao(cliente) {
  if (process.env.CI_BANCO_EFEMERO !== "1")
    throw new Error("Exige banco efemero");
  await cliente.query(
    `DROP POLICY IF EXISTS config_mototaxi_admin_select ON public.config_mototaxi;
     DROP FUNCTION IF EXISTS public.salvar_config_mototaxi(text, text);`,
  );
}

const MOTOTAXI = Object.freeze({
  nome: NOME_MOTOTAXI,
  noAr: NO_AR,
  // Roda logo depois do rollback-manual da 1330 nas listas POSTERIORES_A_97.
  depois: apagarResiduoDoMototaxiNaTransacao,
});

module.exports = { MOTOTAXI, apagarResiduoDoMototaxiNaTransacao };
