-- O pedido avisa o cliente: cada mudança de status nasce um aviso no sino.
--
-- O defeito (laudo "o que falta" 29/08, item 11, degrau 2 — promete o que
-- não cumpre): a tela de pedido feito promete "Você receberá atualizações
-- em breve", mas NENHUM aviso automático nascia quando o pedido mudava —
-- o único insert do lado do cliente era a campanha manual do lojista
-- (AdminPushView, usuario_id nulo). O cliente pagava e ficava no escuro.
--
-- POR QUE UMA TRIGGER (e não insert espalhado nos chamadores): TODOS os
-- caminhos de mudança de status convergem num UPDATE da
-- public.marketplace_orders — a RPC update_order_status_atomic (painel e
-- cancelamento do próprio cliente), a RPC confirmar_pagamento (única
-- escrita do webhook-mercadopago, medido no cabeçalho dela) e writes
-- diretos do admin. Uma trigger AFTER UPDATE OF status cobre os três e os
-- que vierem — sem cada chamador lembrar de avisar.
--
-- O lado do cliente JÁ está pronto e não mexi nele: NotificationContext
-- escuta realtime `notificacoes:{user.id}`, e a linha nova acende o sino
-- sozinha; `dados.order_id` já vira atalho do pedido na tela de avisos.
--
-- DECISÕES DE HONESTIDADE:
--   * Convidado (user_id nulo) NÃO recebe aviso — não tem conta, logo não
--     tem sino. A promessa da tela passa a ser por verdade: quem tem conta
--     lê "aviso aqui no app"; convidado lê o caminho que existe de verdade
--     (código do comprovante em "Meus Pedidos"). Isso é o PR desta trigger.
--   * Sino é best-effort: a falha de inserir o aviso NUNCA derruba a
--     mudança de status (EXCEPTION ... RETURN NEW — o pedido entra, o aviso
--     fica para trás logado no servidor).
--   * Status sem frase desenhada não inventa aviso.
--   * Mudança de status que NÃO muda status (update de tracking_code etc.)
--     não avisa — o sino não vira spam.
--
-- SEM BEGIN/COMMIT (regra da casa). NÃO aplicar sem prova e sem o Gabriel
-- autorizar NESTA sessão.
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (rodar contra o banco; nao rodada por
-- este agente):
--
--   -- 1. A trigger existe e aponta para a função certa:
--   SELECT tgname, tgenabled
--   FROM pg_trigger
--   WHERE tgrelid = 'public.marketplace_orders'::regclass
--     AND NOT tgisinternal;
--   -- esperado: tr_pedido_avisa_o_cliente | O
--
--   -- 2. A função viva tem as 4 frases e as 2 guardas:
--   SELECT
--     pg_get_functiondef('public.notifica_cliente_de_mudanca_de_status()'::regprocedure)
--     AS corpo \gset
--   SELECT
--     ( :corpo LIKE '%Pedido em preparo%' )                 AS tem_preparo,
--     ( :corpo LIKE '%saiu para entrega%' )                 AS tem_entrega,
--     ( :corpo LIKE '%foi entregue%' )                      AS tem_entregue,
--     ( :corpo LIKE '%foi cancelado%' )                     AS tem_cancelado,
--     ( :corpo LIKE '%NEW.user_id IS NULL%' )               AS tem_guarda_convidado,
--     ( :corpo LIKE '%IS NOT DISTINCT FROM%' )              AS tem_guarda_mesmo_status;
--   -- esperado: 1 linha com as 6 colunas = true
--
--   -- 3. Prova funcional (com um pedido de teste real; APAGAR depois):
--   --    UPDATE public.marketplace_orders SET status = 'shipping'
--   --    WHERE id = '<pedido de teste de usuário logado>';
--   --    SELECT titulo, mensagem, dados
--   --    FROM public.notificacoes
--   --    WHERE dados->>'order_id' = '<id do pedido>'
--   --    ORDER BY created_at DESC LIMIT 1;
--   --    esperado: "Pedido a caminho" / "Seu pedido saiu para entrega!"
--   --    com dados->>'order_id' preenchido. Depois devolver o status antigo
--   --    e apagar a notificação de prova.

-- ============================================================
-- Função da trigger
-- ============================================================

CREATE OR REPLACE FUNCTION public.notifica_cliente_de_mudanca_de_status()
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

    -- Só mudança REAL de status: updates que tocam outra coluna (tracking,
    -- notas, gateway) não acendem o sino.
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
        RETURN NEW;
    END IF;

    BEGIN
        CASE NEW.status
            WHEN 'processing' THEN
                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                VALUES (NEW.user_id, 'info', 'Pedido em preparo',
                        'Seu pedido já está em preparo pela loja.',
                        jsonb_build_object('order_id', NEW.id));
            WHEN 'shipping' THEN
                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                VALUES (NEW.user_id, 'info', 'Pedido a caminho',
                        'Seu pedido saiu para entrega!',
                        jsonb_build_object('order_id', NEW.id));
            WHEN 'delivered' THEN
                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                VALUES (NEW.user_id, 'success', 'Pedido entregue',
                        'Seu pedido foi entregue. Obrigado por comprar com a gente!',
                        jsonb_build_object('order_id', NEW.id));
            WHEN 'cancelled' THEN
                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)
                VALUES (NEW.user_id, 'warning', 'Pedido cancelado',
                        'Seu pedido foi cancelado. Se tiver dúvidas, fale com a loja.',
                        jsonb_build_object('order_id', NEW.id));
            ELSE
                -- Status sem frase desenhada (o 'pending' de updates tardios,
                -- um status futuro) não inventa aviso.
                NULL;
        END CASE;
    EXCEPTION WHEN OTHERS THEN
        -- O sino é best-effort: falha de aviso NUNCA reverte a mudança de
        -- status do pedido. O UPDATE segue; a falha fica LOGADA no servidor
        -- para os logs do banco, não engolida em silêncio — defeito de
        -- configuração (permissão, coluna renomeada) tem de aparecer.
        RAISE WARNING
            'notifica_cliente_de_mudanca_de_status: aviso do pedido % nao nasceu (%).',
            NEW.id, SQLERRM;
        NULL;
    END;

    RETURN NEW;
END;
$$;

-- ============================================================
-- A trigger
-- ============================================================

CREATE TRIGGER tr_pedido_avisa_o_cliente
AFTER UPDATE OF status ON public.marketplace_orders
FOR EACH ROW EXECUTE FUNCTION public.notifica_cliente_de_mudanca_de_status();
