-- O LOG DE PUSH NASCE HONESTO (laudo novos ângulos 01/09, achado A10).
--
-- O DEFEITO: `answer_question_atomic` e `reply_review_atomic` gravam
-- `push_notifications_log` com `recipient_count = 1` SEM chamar o
-- `send-push` e SEM inserir em `notificacoes` — e cada edição da resposta
-- (ou da réplica da avaliação) insere OUTRA linha. Desde o conserto
-- PUSH-010 o contrato do log é "nasce com 0 e só sobe quando a edge
-- function CONFIRMAR entrega"; estas duas RPCs eram as exceções. O painel
-- (AdminPushView) renderizava a mentira como "Entregue · 1 aparelho".
--
-- O QUE ESTA MIGRATION FAZ:
--   1. CREATE OR REPLACE das duas RPCs — assinatura INTACTA, nenhuma
--      sobrecarga nova (regra da casa pós-bomba de assinatura) — com
--      `recipient_count = 0` e o comentário-marcador "A10: log honesto"
--      no corpo (é o que o db-apply confere);
--   2. Limpeza das linhas já gravadas com a mentira: `recipient_count`
--      volta para 0 nas linhas com ESTES títulos e count = 1. Grep no
--      repo inteiro provou que NENHUM outro caminho grava esses títulos
--      (o painel de campanha usa título digitado pelo lojista), então o
--      UPDATE não toca entrega real nenhuma.
--
-- SEM BEGIN/COMMIT (regra da casa: o db-apply abre a transação).
--
-- FICHA DE VERIFICAÇÃO pos-aplicação: scripts/db-prove-push-log-honesto.cjs
-- (transação descartável com claims de admin: cada RPC grava a linha com
-- 0; re-editar grava outra linha, também 0; ROLLBACK no fim, resíduo zero).
-- Marcadores no VERIFICACOES do db-apply: "A10: log honesto" nos 2 corpos.
--
-- ROLLBACK MANUAL: versionado em
-- rollback-manual-20261064000000_o_log_de_push_nasce_honesto.sql
-- (restaura os corpos com `1`; a limpeza do item 2 é de mão única — as
-- linhas antigas permanecem honestas, e é isso que se espera delas).

CREATE OR REPLACE FUNCTION public.answer_question_atomic(p_question_id uuid, p_answer text, p_admin_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
BEGIN
    -- SECURITY CHECK: Reject any caller that is not an admin
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can answer questions.';
    END IF;

    -- 1. Upsert Answer (mesmo caminho da sobrecarga de 2 args, ver acima)
    INSERT INTO public.answers (question_id, user_id, answer)
    VALUES (p_question_id, p_admin_id, p_answer)
    ON CONFLICT (question_id) DO UPDATE
       SET answer     = EXCLUDED.answer,
           user_id    = EXCLUDED.user_id,
           created_at = timezone('utc', now());

    -- 2. Get Question Info
    SELECT user_id, product_id INTO v_user_id, v_product_id
    FROM public.questions WHERE id = p_question_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM public.produtos WHERE id = v_product_id;

        -- 3. Log Notification — A10: log honesto, nasce com 0; só sobe
        --    quando o send-push CONFIRMAR entrega (contrato PUSH-010).
        INSERT INTO public.push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua pergunta foi respondida!',
            'A loja respondeu a sua pergunta sobre o produto ' || COALESCE(v_product_name, 'selecionado') || '.',
            '/product/' || v_product_id,
            0,
            p_admin_id
        );
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reply_review_atomic(p_review_id uuid, p_reply text, p_admin_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
BEGIN
    -- SECURITY CHECK: Reject any caller that is not an admin
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can reply to reviews.';
    END IF;

    -- 1. Update Review
    UPDATE public.reviews
    SET merchant_reply = p_reply, merchant_reply_at = NOW()
    WHERE id = p_review_id
    RETURNING user_id, product_id INTO v_user_id, v_product_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM public.produtos WHERE id = v_product_id;

        -- 2. Log Notification for Admin Visibility — A10: log honesto,
        --    nasce com 0; só sobe quando o send-push CONFIRMAR entrega.
        INSERT INTO public.push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua avaliacao foi respondida!',
            'A loja respondeu a sua avaliacao no produto ' || COALESCE(v_product_name, 'comprado') || '.',
            '/product/' || v_product_id,
            0,
            p_admin_id
        );
    END IF;
END;
$function$;

-- 2. As linhas que já nasceram mentindo voltam para 0 (inclui a grafia
--    antiga com acento, do baseline, e a viva sem acento).
UPDATE public.push_notifications_log
   SET recipient_count = 0
 WHERE recipient_count = 1
   AND title IN ('Sua pergunta foi respondida!',
                 'Sua avaliacao foi respondida!',
                 'Sua avaliação foi respondida!');
