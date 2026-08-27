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
--
-- A ORDEM DESTE ARQUIVO E' A CORRECAO, NAO ESTILO. Nao reordene. O
-- db-apply.cjs aplica MIGRATION dentro de uma transacao, mas NUNCA aplica
-- rollback-manual -- conferido, zero referencias no script. A reversao roda
-- a mao, fora de transacao, e cada comando confirma sozinho. Um comando que
-- falha no meio deixa tudo que veio antes ja gravado. A versao anterior
-- deste arquivo punha a constraint por ultimo "para falhar barulhento" --
-- medido: ela falharia DEPOIS de DROP FUNCTION, DROP TABLE e os dois DROP
-- COLUMN ja terem confirmado, e o DROP CONSTRAINT tambem ja teria passado --
-- deixando a marketplace_orders SEM NENHUMA trava em payment_status, a
-- guarda que existe desde 20260807000000 simplesmente sumida, e o historico
-- que diria quais pedidos causaram a falha ja apagado. Barulho no fim nao e'
-- o mesmo que seguranca.

-- 0. PORTAO: recusa a reversao enquanto ela apagaria registro de pagamento.
--    Vem PRIMEIRO porque cada comando deste arquivo confirma sozinho (o
--    db-apply.cjs nao aplica rollback-manual -- isto roda a mao). Falhando
--    aqui, NADA foi destruido ainda: a funcao, a tabela de historico, as duas
--    colunas e a constraint continuam todas de pe.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.marketplace_orders
         WHERE payment_status = 'recebido_na_entrega'
    ) THEN
        RAISE EXCEPTION 'Reversao recusada: existem pedidos com pagamento marcado como recebido na entrega. Reverter apagaria esse registro (a coluna, o historico e o proprio status). Desmarque-os pelo painel, ou decida explicitamente descarta-los, antes de rodar este arquivo.';
    END IF;
END $$;

-- 1. A constraint volta aos SEIS valores de 20260807000000. Depois do portao
--    acima, nenhuma linha viola, entao o ADD nao pode falhar -- e a janela em
--    que a tabela fica sem trava dura o intervalo entre estes dois comandos,
--    com o resto do schema intacto.
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

-- 2. So agora o que destroi.
DROP FUNCTION IF EXISTS public.registrar_pagamento_recebido(uuid, boolean);

DROP TABLE IF EXISTS public.marketplace_order_payment_history;

ALTER TABLE public.marketplace_orders DROP COLUMN IF EXISTS pagamento_recebido_em;
ALTER TABLE public.marketplace_orders DROP COLUMN IF EXISTS pagamento_recebido_por;
