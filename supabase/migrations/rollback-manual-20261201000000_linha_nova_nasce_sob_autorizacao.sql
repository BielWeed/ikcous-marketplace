-- ============================================================================
-- Rollback manual — linha nova nasce sob autorização (20261201000000)
-- ============================================================================
-- Desfaz a 20261201000000: tira o DEFAULT true de
-- `order_refunds.criada_sob_autorizacao`. Seguro a qualquer momento: linha
-- nova volta a nascer NULL (legado), e para ela o executor aplica a regra
-- conservadora (`tentativas > 1` = pode ter chegado ao MP; nunca recusada sem
-- veredito). NENHUMA linha de `order_refunds` é tocada — as que nasceram true
-- continuam true (nasceram com as edges novas no ar).
--
-- ORDEM DE DESFAZER: 20261201000000 (este) -> edges -> 20261196000000 ->
-- 20261192000000. É o PRIMEIRO passo: o rollback da 96 recusa enquanto este
-- DEFAULT estiver no ar.
--
-- NO WINDOWS: rode `$env:PGCLIENTENCODING='UTF8'` no PowerShell ANTES do psql.
--
-- PRÉ-VOO: recusa com `B1_BASELINE_DIVERGENT` se o DEFAULT true não estiver
-- lá (nada a desfazer — o 2º rollback recusa). Mesma transação do restante.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply, que registraria este
-- rollback no ledger de migrations como se fosse uma migration nova). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261201$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO v_def
    FROM pg_attribute a
    JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.order_refunds'::regclass
     AND a.attname = 'criada_sob_autorizacao'
     AND NOT a.attisdropped;
  IF v_def IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.order_refunds.criada_sob_autorizacao sem DEFAULT true (default atual: %) — nada a desfazer; revise antes de reverter.', v_def;
  END IF;
END $preflight_rollback_20261201$;

ALTER TABLE public.order_refunds ALTER COLUMN criada_sob_autorizacao DROP DEFAULT;
