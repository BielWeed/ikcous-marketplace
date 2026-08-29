-- O pagamento avisa o cliente: PIX caiu, o sino acende.
--
-- Follow-up do item 11 do laudo (PR #343), apontado pela revisão 5.3: o
-- ramo 'pago' do confirmar_pagamento muda só `payment_status` — a trigger
-- tr_pedido_avisa_o_cliente (20261026000000) dispara em `status` e fica
-- muda. O aviso que o cliente MAIS espera (o dinheiro dele entrou) não
-- nascia; hoje o lojista cobre com push manual.
--
-- O que esta trigger avisa (AFTER UPDATE OF payment_status):
--   * 'pago'             → "Pagamento confirmado!" (tipo 'pagamento');
--   * 'pago_apos_expirar' → o caso "dinheiro entrou, mas o pedido tinha
--     sido cancelado ou expirado" (confirmar_pagamento grava este valor e
--     o painel marca needsAttention). Frase honesta: a loja JÁ foi avisada
--     (o badge de atenção) e vai resolver com o cliente.
--   * 'expirado', 'estornado', 'aguardando' e qualquer valor futuro ficam
--     silenciosos POR DESENHO — cada frase nova é decisão de produto, não
--     efeito colateral de uma coluna mudando.
--
-- Mesmo esqueleto da trigger irmã (20261026000000): convidado (user_id
-- nulo) não recebe; mudança que não muda o valor não avisa; sino é
-- best-effort com falha LOGADA (RAISE WARNING), nunca derruba a escrita;
-- SECURITY DEFINER cruza a RLS de notificacoes.
--
-- As DUAS triggers coexistem: quando uma escrita muda status E
-- payment_status ao mesmo tempo, cada uma avisa o seu — são dois fatos.
--
-- SEM BEGIN/COMMIT (regra da casa). NÃO aplicar sem prova e sem o Gabriel
-- autorizar NESTA sessão.
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (rodar contra o banco; nao rodada por
-- este agente):
--
--   -- 1. A trigger existe:
--   SELECT tgname, tgenabled
--   FROM pg_trigger
--   WHERE tgrelid = 'public.marketplace_orders'::regclass
--     AND NOT tgisinternal;
--   -- esperado: tr_pagamento_avisa_o_cliente | O (ao lado da irmã de status)
--
--   -- 2. A função viva tem as 2 frases e as 2 guardas:
--   SELECT
--     (pg_get_functiondef('public.notifica_cliente_de_mudanca_de_pagamento()'::regprocedure)
--       LIKE '%Pagamento confirmado%')                       AS tem_confirmado,
--     (pg_get_functiondef('public.notifica_cliente_de_mudanca_de_pagamento()'::regprocedure)
--       LIKE '%tinha sido cancelado ou expirado%')           AS tem_apos_expirar,
--     (pg_get_functiondef('public.notifica_cliente_de_mudanca_de_pagamento()'::regprocedure)
--       LIKE '%NEW.user_id IS NULL%')                        AS tem_guarda_convidado,
--     (pg_get_functiondef('public.notifica_cliente_de_mudanca_de_pagamento()'::regprocedure)
--       LIKE '%OLD.payment_status IS NOT DISTINCT FROM%')    AS tem_guarda_corrida;
--   -- esperado: 1 linha com as 4 colunas = true
--
--   -- 3. Prova funcional (pedido de teste de usuário logado; APAGAR depois):
--   --    UPDATE public.marketplace_orders
--   --       SET payment_status = 'pago'
--   --     WHERE id = '<pedido de teste com payment_status = aguardando>';
--   --    SELECT titulo, mensagem, dados FROM public.notificacoes
--   --     WHERE dados->>'order_id' = '<id>' ORDER BY created_at DESC LIMIT 1;
--   --    esperado: "Pagamento confirmado!" / "Recebemos seu pagamento..."

-- ============================================================
-- Função da trigger
-- ============================================================

CREATE OR REPLACE FUNCTION public.notifica_cliente_de_mudanca_de_pagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Convidado não tem conta, logo não tem sino: sem usuário, sem aviso.
    IF NEW.user_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Só mudança REAL do pagamento: escritas que gravam o mesmo valor não
    -- acendem o sino.
    IF OLD.payment_status IS NOT DISTINCT FROM NEW.payment_status THEN
        RETURN NEW;
    END IF;

    BEGIN
        CASE NEW.payment_status
            WHEN 'pago' THEN
                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                VALUES (NEW.user_id, 'pagamento', 'Pagamento confirmado',
                        'Recebemos seu pagamento. Obrigado!',
                        jsonb_build_object('order_id', NEW.id));
            WHEN 'pago_apos_expirar' THEN
                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                VALUES (NEW.user_id, 'warning', 'Pagamento recebido após o cancelamento',
                        'Recebemos seu pagamento, mas o pedido tinha sido cancelado ou expirado. A loja já foi avisada e vai resolver isso com você.',
                        jsonb_build_object('order_id', NEW.id));
            ELSE
                -- 'expirado' (a varredura avisa? não — é decisão de produto),
                -- 'estornado', 'aguardando' e valores futuros: sem frase
                -- desenhada, sem aviso inventado.
                NULL;
        END CASE;
    EXCEPTION WHEN OTHERS THEN
        -- O sino é best-effort: falha de aviso NUNCA reverte a mudança do
        -- pagamento. O UPDATE segue; a falha fica LOGADA no servidor para
        -- os logs do banco, não engolida em silêncio.
        RAISE WARNING
            'notifica_cliente_de_mudanca_de_pagamento: aviso do pedido % nao nasceu (%).',
            NEW.id, SQLERRM;
        NULL;
    END;

    RETURN NEW;
END;
$$;

-- ============================================================
-- A trigger
-- ============================================================

CREATE TRIGGER tr_pagamento_avisa_o_cliente
AFTER UPDATE OF payment_status ON public.marketplace_orders
FOR EACH ROW EXECUTE FUNCTION public.notifica_cliente_de_mudanca_de_pagamento();
