"use strict";
// Definicao unica da 20261530000000 (a loja grande nao trava o balcao nem os avisos) para as provas que desfazem as
// posteriores ANTES de reverter a 20261197000000 (admin-atual-viva.cjs e pagamentos-rpc-viva.cjs).
//
// A porta leve buscar_clientes_do_balcao copia as guardas da get_admin_customers_paged e chama is_admin_atual(): o
// rollback da 97 RECUSA (B1_BASELINE_DIVERGENT: "funcoes fora da 20261197000000 ainda usam ...") enquanto ela estiver
// no ar. Esse comportamento e' o certo e nao e' afrouxado aqui. O rollback-manual dela derruba so a porta e os dois
// indices (nenhum dado e tocado) e nao depende de nenhuma outra da lista; recusa porta ou indice que nao sejam os
// desta migration, entao so roda se a porta estiver no ar. Entrada no formato { nome, noAr } das listas POSTERIORES_A_97.
const A_LOJA_GRANDE = Object.freeze({
  nome: "20261530000000_a_loja_grande_nao_trava_o_balcao_nem_os_avisos.sql",
  // "No ar" = a porta que so esta migration cria existe (o rollback a tira; depois dele nao ha o que desfazer).
  noAr: "SELECT to_regprocedure('public.buscar_clientes_do_balcao(text,integer)') IS NOT NULL AS sim",
});

module.exports = { A_LOJA_GRANDE };
