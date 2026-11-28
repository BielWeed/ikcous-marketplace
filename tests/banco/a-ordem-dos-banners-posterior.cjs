"use strict";
// Definicao unica da 20261651000000 (a ordem dos banners muda numa trava so) para as provas que desfazem as
// posteriores ANTES de reverter a 20261197000000 (admin-atual-viva.cjs e pagamentos-rpc-viva.cjs).
//
// As duas RPCs novas normalize_banners_atomic e move_banner_atomic chamam is_admin_atual(): o rollback da 97 RECUSA
// (B1_BASELINE_DIVERGENT: "funcoes fora da 20261197000000 ainda usam ...") enquanto elas estiverem no ar. Esse
// comportamento e' o certo e nao e' afrouxado aqui. O rollback-manual dela derruba so as duas funcoes (nenhum dado e
// tocado; a reorder_banners_atomic antiga fica como estava) e nao depende de nenhuma outra da lista; so roda se as
// funcoes estiverem no ar. Entrada no formato { nome, noAr } das listas POSTERIORES_A_97.
const A_ORDEM_DOS_BANNERS = Object.freeze({
  nome: "20261651000000_a_ordem_dos_banners_muda_numa_trava_so.sql",
  // "No ar" = a funcao que so esta migration cria existe (o rollback a tira; depois dele nao ha o que desfazer).
  noAr: "SELECT to_regprocedure('public.move_banner_atomic(text,uuid,text)') IS NOT NULL AS sim",
});

module.exports = { A_ORDEM_DOS_BANNERS };
