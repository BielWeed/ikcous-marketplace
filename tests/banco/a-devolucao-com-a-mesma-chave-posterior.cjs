"use strict";
// Definicao unica da 20261640000000 (a devolucao com a mesma chave nao paga duas vezes) para as provas que desfazem as posteriores
// ANTES de reverter a 20261197000000 (admin-atual-viva.cjs e pagamentos-rpc-viva.cjs).
//
// A RPC solicitar_estorno_com_chave chama is_admin_atual(): sem esta entrada o rollback da 97 recusa (B1_BASELINE_DIVERGENT:
// "funcoes fora da 20261197000000 ainda usam ..."). O rollback-manual (comum) dela tira SO a funcao e DEIXA a coluna
// order_refunds.chave_da_solicitacao e o indice unico parcial (nada que a 97 confira). Nao depende de nenhuma outra da lista.
const DEVOLUCAO_COM_CHAVE = Object.freeze({
  nome: "20261640000000_a_devolucao_com_a_mesma_chave_nao_paga_duas_vezes.sql",
  noAr: `SELECT to_regprocedure('public.solicitar_estorno_com_chave(uuid,numeric,text,uuid)') IS NOT NULL AS sim`,
});

module.exports = { DEVOLUCAO_COM_CHAVE };
