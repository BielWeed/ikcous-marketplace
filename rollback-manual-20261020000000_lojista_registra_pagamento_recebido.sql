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

-- A constraint volta aos SEIS valores originais de 20260807000000. Isto vem por
-- ULTIMO de proposito: se algum pedido tiver ficado com o setimo valor
-- (recebido na entrega), o ADD CONSTRAINT falha aqui e o rollback para --
-- barulhento, que e' o certo. Reverter em silencio deixaria linha viva com
-- estado que a constraint restaurada nao aceita, e o proximo UPDATE naquele
-- pedido (por qualquer motivo) morreria sem ninguem entender por que.
ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_payment_status_check;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_payment_status_check
  CHECK (
    payment_status IS NULL
    OR payment_status = ANY (ARRAY[
      'aguardando'::text,
      'pago'::text,
      'recusado'::text,
      'expirado'::text,
      'estornado'::text,
      'pago_apos_expirar'::text
    ])
  );
