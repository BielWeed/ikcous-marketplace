-- Reversao manual da migration
-- 20261020000000_lojista_registra_pagamento_recebido.sql.
--
-- Sem BEGIN/COMMIT de proposito: com eles o ROLLBACK do script de prova vira
-- no-op.
--
-- Aqui as colunas CAEM (ao contrario do rollback da 20260970000000, que
-- deixa as dela de proposito): esta migration e' aditiva e nenhum pedido
-- real tem valor nessas colunas no momento em que ela e' revertida. Se um
-- dia houver dado gravado ali, este rollback passa a apagar historico e
-- precisa ser revisto.

DROP FUNCTION IF EXISTS public.registrar_pagamento_recebido(uuid, boolean);

DROP TABLE IF EXISTS public.marketplace_order_payment_history;

ALTER TABLE public.marketplace_orders DROP COLUMN IF EXISTS pagamento_recebido_em;
ALTER TABLE public.marketplace_orders DROP COLUMN IF EXISTS pagamento_recebido_por;
