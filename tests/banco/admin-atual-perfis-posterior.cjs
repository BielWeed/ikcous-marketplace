"use strict";

/**
 * A migration 20261340000000 (as politicas de perfil, endereco, carrinho, push, notificacao, analytics e credenciais de
 * frete exigem o admin de agora; 21/10/2026) troca, em 13 politicas, `is_admin()` por `rls_admin_atual()` de PROPOSITO
 * (a funcao e' criada pela 20261197000000).
 *
 * O rollback da 97 apaga `is_admin_atual()` e `rls_admin_atual()` e, por isso, RECUSA (B1_BASELINE_DIVERGENT) enquanto
 * qualquer politica fora da 97 ainda as usa. Esse e' o comportamento CERTO e nao e' afrouxado aqui. Toda prova viva que
 * desfaz a 97 dentro da transacao (ou mede a 95 isolada) tem de desfazer ANTES as posteriores que dependem dela; este
 * modulo e' a entrada unica desta migration, no formato { nome, noAr } das listas POSTERIORES_A_97.
 *
 * O rollback-manual da 1340 devolve as 13 expressoes a `is_admin()` (nenhuma politica e apagada, nenhum dado muda), entao
 * basta rodar o rollback dele. Ele recusa se alguma das 13 nao estiver no estado "desta migration"; por isso o `noAr`
 * olha uma politica de cada vez que importa (a de `profiles`, que e' a que o pre-voo da 97 acharia primeiro).
 */

const NOME_PERFIS_ADMIN_ATUAL =
  "20261340000000_as_politicas_de_perfil_e_endereco_exigem_o_admin_atual.sql";

const PERFIS_ADMIN_ATUAL = Object.freeze({
  nome: NOME_PERFIS_ADMIN_ATUAL,
  // "No ar" = a politica de SELECT de profiles cita rls_admin_atual() (o rollback-manual dela exige as 13 desse jeito).
  noAr: `SELECT EXISTS (
       SELECT 1 FROM pg_policy
        WHERE polname = 'profiles_select_policy'
          AND polrelid = to_regclass('public.profiles')
          AND pg_get_expr(polqual, polrelid) LIKE '%rls_admin_atual%') AS sim`,
});

module.exports = { PERFIS_ADMIN_ATUAL };
