-- ============================================================================
-- Rollback manual — o CRM e o Início leem a loja (20261178000000)
-- ============================================================================
-- Reverter PRIMEIRO o front (Início, Dashboard CRM); só depois executar este
-- arquivo. psql -1 -f — nunca pelo db-apply. Só funções de leitura: não há
-- dado a perder. `IF EXISTS` em tudo.
-- ============================================================================

DROP FUNCTION IF EXISTS public.painel_inicio();
DROP FUNCTION IF EXISTS public.crm_clientes(text, text, integer, integer);
DROP FUNCTION IF EXISTS public.crm_visao(date, date);
DROP FUNCTION IF EXISTS public.crm__clientes_rfm(timestamptz);
DROP FUNCTION IF EXISTS public.crm__vendas(timestamptz);
