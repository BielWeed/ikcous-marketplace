"use strict";
// Definicao unica da 20261550000000 (o admin copia e apaga as fotos da loja) para as provas que desfazem as posteriores ANTES de reverter
// a 20261197000000 (admin-atual-viva.cjs e pagamentos-rpc-viva.cjs).
//
// As duas politicas SELECT "Admin Select Access (products|banners)" de storage.objects citam rls_admin_atual(): sem esta entrada o
// rollback da 97 recusa (B1_BASELINE_DIVERGENT: "politicas fora da 20261197000000 ainda usam ..."). O rollback-manual dela so tira as duas
// politicas (nenhum arquivo, bucket ou outra politica muda) e nao depende de nenhuma outra da lista. Entrada no formato { nome, noAr }.
const FOTOS_DA_LOJA = Object.freeze({
  nome: "20261550000000_o_admin_copia_e_apaga_as_fotos_da_loja.sql",
  // "No ar" = alguma das duas politicas existe (o rollback tira as duas; depois dele nao ha o que desfazer).
  noAr: `SELECT EXISTS (
       SELECT 1 FROM pg_policy
        WHERE polrelid = to_regclass('storage.objects')
          AND polname IN ('Admin Select Access (products)', 'Admin Select Access (banners)')) AS sim`,
});

module.exports = { FOTOS_DA_LOJA };
