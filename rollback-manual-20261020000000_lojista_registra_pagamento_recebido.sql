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
-- A REVERSAO INTEIRA VAI NUM UNICO BLOCO DO. Bloco DO e' UM comando, e um
-- comando e' uma transacao -- entao ou a reversao inteira acontece, ou nada
-- acontece. O db-apply.cjs aplica MIGRATION dentro de uma transacao, mas
-- NUNCA aplica rollback-manual -- conferido, zero referencias no script. A
-- reversao roda a mao, fora de transacao, e por isso precisava desta
-- atomicidade: uma versao anterior deste arquivo era tres comandos soltos
-- (portao / DROP CONSTRAINT / ADD CONSTRAINT), cada um confirmando sozinho.
-- Medido: bastava o portao cair ENTRE o DROP e o ADD -- ou alguem clicar
-- "recebi" no painel nesse intervalo -- para a marketplace_orders ficar SEM
-- NENHUMA trava em payment_status, a guarda que existe desde 20260807000000
-- simplesmente sumida, e o historico que diria quais pedidos causaram a
-- falha ja apagado. Barulho no fim nao e' o mesmo que seguranca, e uma
-- assercao de ordem so' guarda contra a forma que ja foi vista quebrar --
-- o bloco atomico fecha a classe inteira: nao existe mais "entre os
-- comandos", e a corrida contra o clique do lojista deixa de existir.
--
-- A mensagem do portao fala de payment_status, e e' isso que o predicado
-- olha. Ela NAO promete nada sobre a tabela de historico: um pedido marcado
-- e depois desmarcado pelo painel volta a payment_status = NULL e deixa
-- duas linhas no historico, que o DROP TABLE apaga. Isso e' decisao de
-- produto do Gabriel, esta anotado, e nao e' resolvido aqui.

DO $$
BEGIN
    -- PORTAO: recusa enquanto a reversao apagaria registro de pagamento.
    -- Dentro do bloco atomico, entao nem o DROP CONSTRAINT chega a acontecer.
    IF EXISTS (
        SELECT 1 FROM public.marketplace_orders
         WHERE payment_status = 'recebido_na_entrega'
    ) THEN
        RAISE EXCEPTION 'Reversao recusada: existem pedidos com pagamento '
            'marcado como recebido na entrega. Reverter apagaria esse '
            'registro. Desmarque-os pelo painel, ou decida explicitamente '
            'descarta-los, antes de rodar este arquivo.';
    END IF;

    -- A constraint volta aos SEIS valores de 20260807000000.
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

    DROP FUNCTION IF EXISTS public.registrar_pagamento_recebido(uuid, boolean);

    DROP TABLE IF EXISTS public.marketplace_order_payment_history;

    ALTER TABLE public.marketplace_orders
      DROP COLUMN IF EXISTS pagamento_recebido_em;
    ALTER TABLE public.marketplace_orders
      DROP COLUMN IF EXISTS pagamento_recebido_por;
END $$;
