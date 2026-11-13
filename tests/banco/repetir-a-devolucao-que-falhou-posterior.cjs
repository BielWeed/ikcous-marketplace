"use strict";
// Definicao unica da 20261399991000 (repetir a devolucao que falhou nao paga duas vezes) para as provas que
// desfazem as posteriores ANTES de reverter a 20261197000000 (admin-atual-viva.cjs e pagamentos-rpc-viva.cjs).
//
// A RPC solicitar_estorno_repetindo usa is_admin_atual(): sem esta entrada o rollback da 97 recusa
// (B1_BASELINE_DIVERGENT: "funcoes fora da 20261197000000 ainda usam ..."). O rollback-manual dela so apaga a funcao e a
// tabela order_refund_repeticao (e recusa se ja houver marca; num banco de prova recem-migrado nao ha). Nao depende de
// nenhuma outra da lista.
const REPETIR_A_DEVOLUCAO = {
  nome: "20261399991000_repetir_a_devolucao_que_falhou_nao_paga_duas_vezes.sql",
  noAr: `SELECT to_regprocedure('public.solicitar_estorno_repetindo(uuid,text)') IS NOT NULL AS sim`,
};

module.exports = { REPETIR_A_DEVOLUCAO };
