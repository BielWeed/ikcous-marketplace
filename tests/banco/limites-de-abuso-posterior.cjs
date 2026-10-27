"use strict";
// Definicao unica das migrations do lote 234 que a prova do admin atual (admin-atual-viva.cjs) e a dos pagamentos
// (pagamentos-rpc-viva.cjs) desfazem ANTES de reverter a 20261197000000.
//
// 20261396000000 e 20261396100000: os gatilhos de aparelhos com aviso (push_inscricoes_limite_por_conta) e da data
// da pergunta (pergunta_nasce_com_a_data_de_agora) chamam rls_admin_atual(): sem estas entradas o rollback da 97
// recusa (B1_BASELINE_DIVERGENT: "funcoes fora da 20261197000000 ainda usam ..."). Os rollbacks so tiram gatilho e
// funcao, sem depender de nenhuma outra da lista. A 20261396200000 (CHECK da avaliacao) nao usa o admin atual.
const LIMITES_DE_ABUSO = [
  {
    nome: "20261396000000_cada_conta_tem_no_maximo_10_aparelhos_com_aviso.sql",
    noAr: `SELECT to_regprocedure('public.push_inscricoes_limite_por_conta()') IS NOT NULL AS sim`,
  },
  {
    nome: "20261396100000_a_pergunta_nasce_com_a_data_de_agora.sql",
    noAr: `SELECT to_regprocedure('public.pergunta_nasce_com_a_data_de_agora()') IS NOT NULL AS sim`,
  },
];

module.exports = { LIMITES_DE_ABUSO };
