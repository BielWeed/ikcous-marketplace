-- Rollback manual da 20261600000000 (a loja pausa o pedido novo).
-- Tira os gatilhos e as funcoes que a migration criou. MANTEM a tabela public.pausa_de_vendas com as linhas (o destrutivo e' quem a apaga).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP TRIGGER IF EXISTS tr_a_loja_aceita_pedido_novo ON public.marketplace_orders;
DROP TRIGGER IF EXISTS tr_assinatura_marca_suspensa_desde ON public.assinatura_da_loja;
DROP FUNCTION IF EXISTS public.a_loja_aceita_pedido_novo();
DROP FUNCTION IF EXISTS public.marcar_suspensa_desde();
DROP FUNCTION IF EXISTS public.motivo_da_loja_nao_aceitar_pedido();
DROP FUNCTION IF EXISTS public.data_da_pausa_de_vendas(date, date, date, date);

NOTIFY pgrst, 'reload schema';
