-- ============================================================================
-- Rollback manual — o cartão online nasce (20261176000000)
-- ============================================================================
-- Reverter PRIMEIRO as edges (criar-pagamento aceitando cartão, webhook e
-- reconciliação chamando liberar_cobranca_do_pedido) e o front (opção de
-- cartão no checkout, interruptores no painel); só depois executar este
-- arquivo. Com as edges novas no ar e este rollback aplicado, a recusa de
-- cartão cairia num RPC inexistente. psql -1 -f — nunca pelo db-apply.
--
-- Remove as RPCs, a tabela de configuração e as CHECKs das colunas novas.
-- As COLUNAS `tentativas_de_pagamento`, `metodo_online` e `parcelas` FICAM:
-- guardam como cada pedido foi pago (mesma régua da rollback-manual-
-- 20261174000000, que não derruba a configuração que o lojista já salvou).
-- `IF EXISTS` em tudo: repetir não dá erro.
-- ============================================================================

DROP FUNCTION IF EXISTS public.liberar_cobranca_do_pedido(uuid, text);
DROP FUNCTION IF EXISTS public.salvar_config_pagamento_cartao(boolean, boolean, integer);
DROP TABLE IF EXISTS public.config_pagamento_cartao;

ALTER TABLE public.marketplace_orders DROP CONSTRAINT IF EXISTS marketplace_orders_tentativas_de_pagamento_check;
ALTER TABLE public.marketplace_orders DROP CONSTRAINT IF EXISTS marketplace_orders_metodo_online_check;
ALTER TABLE public.marketplace_orders DROP CONSTRAINT IF EXISTS marketplace_orders_parcelas_check;
