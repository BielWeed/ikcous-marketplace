"use strict";

/**
 * A migration 20261330000000 (contato do mototaxi privado; 21/10/2026) cria DUAS coisas que citam as portas da
 * 20261197000000 de PROPOSITO: a funcao public.salvar_config_mototaxi(text, text) (SECURITY DEFINER, so admin: usa
 * is_admin() e is_admin_atual()) e a politica config_mototaxi_admin_select (rls_admin_atual()).
 *
 * O rollback da 97 apaga is_admin_atual() e rls_admin_atual() e, por isso, RECUSA (B1_BASELINE_DIVERGENT) enquanto
 * qualquer funcao ou politica fora da 97 ainda as usa. Esse e o comportamento CERTO e nao e afrouxado aqui. Toda prova
 * viva que desfaz a 97 dentro da transacao (ou mede a 95 isolada) tem de desfazer ANTES as posteriores que dependem
 * dela; este modulo e a entrada unica da mototaxi, no formato { nome, noAr } das listas POSTERIORES_A_97.
 *
 * O rollback-manual da 1330 apaga a funcao e a politica (e so elas: tabela e contato ficam, com RLS ligada, sem politica
 * e sem grant para PUBLIC, anon e authenticated), entao basta rodar o rollback dela. Nao ha limpeza extra de proposito:
 * se um dia o rollback voltar a deixar a funcao ou a politica, o rollback da 97 recusa e estas provas reprovam.
 */

const NOME_MOTOTAXI = "20261330000000_mototaxi_privado.sql";

const MOTOTAXI = Object.freeze({
  nome: NOME_MOTOTAXI,
  // "No ar" = a RPC existe (o rollback-manual dela exige o corpo dela; sem a funcao ele recusa).
  noAr: `SELECT to_regprocedure('public.salvar_config_mototaxi(text,text)') IS NOT NULL AS sim`,
});

module.exports = { MOTOTAXI };
