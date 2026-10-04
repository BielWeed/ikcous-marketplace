-- ============================================================================
-- Rollback manual — a contestação decide sob a trava do pedido (20261196000000)
-- ============================================================================
-- Desfaz a 20261196000000: apaga as duas funções novas
-- (`public.registrar_contestacao_no_ledger` e
-- `public.registrar_estorno_externo_do_mp`). Elas NÃO existiam antes
-- desta migration — não há corpo anterior a restaurar. NENHUMA linha de
-- `order_refunds` é tocada. As colunas `mp_chargeback_case_id` e
-- `mp_chargeback_valor_do_caso` e a tabela `public.contestacoes_decisao_final`
-- FICAM, de propósito: apagá-las perderia o vínculo, o valor confirmado e o
-- histórico das decisões finais de casos já registrados (dado de dinheiro) —
-- se um dia for preciso, é decisão do dono, com o SQL mostrado.
--
-- Depois do rollback a edge NOVA do webhook falha ao registrar contestação
-- (função ausente -> 500, o MP reenvia; nada é gravado pela metade).
-- Reverter a edge para a versão anterior ANTES deste rollback.
--
-- NO WINDOWS: rode `$env:PGCLIENTENCODING='UTF8'` no PowerShell ANTES do psql.
--
-- PRÉ-VOO: recusa com `B1_BASELINE_DIVERGENT` se uma das funções não existir
-- com a assinatura desta migration — nada a desfazer, ou outra coisa está no
-- ar. Mesma transação do restante.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply, que registraria este
-- rollback no ledger de migrations como se fosse uma migration nova). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261196$
BEGIN
  IF to_regprocedure('public.registrar_contestacao_no_ledger(uuid, text, text, text, numeric, numeric, integer)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.registrar_contestacao_no_ledger(...) ausente — nada a desfazer; revise antes de reverter.';
  END IF;
  IF to_regprocedure('public.registrar_estorno_externo_do_mp(uuid, text, numeric, text, text)') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.registrar_estorno_externo_do_mp(...) ausente — nada a desfazer; revise antes de reverter.';
  END IF;
END $preflight_rollback_20261196$;

DROP FUNCTION public.registrar_contestacao_no_ledger(uuid, text, text, text, numeric, numeric, integer);
DROP FUNCTION public.registrar_estorno_externo_do_mp(uuid, text, numeric, text, text);
