"use strict";
// Definicao unica da 20261399000000 (as visitas da loja contam pelo porteiro) para as provas que desfazem as
// posteriores ANTES de reverter a 20261197000000 (admin-atual-viva.cjs e pagamentos-rpc-viva.cjs).
//
// A RPC crm_visitas usa is_admin_atual(): sem esta entrada o rollback da 97 recusa (B1_BASELINE_DIVERGENT: "funcoes
// fora da 20261197000000 ainda usam ..."). O rollback-manual (comum) dela so apaga contar_entrada e crm_visitas e DEIXA
// a tabela visitas_por_dia; nao depende de nenhuma outra da lista.
const AS_VISITAS = {
  nome: "20261399000000_as_visitas_da_loja_contam_pelo_porteiro.sql",
  noAr: `SELECT to_regprocedure('public.crm_visitas(date,date)') IS NOT NULL AS sim`,
};

module.exports = { AS_VISITAS };
