-- ROLLBACK MANUAL de 20261064000000_o_log_de_push_nasce_honesto.sql
-- (laudo novos ângulos 01/09, achado A10).
--
-- O que a migration forward fez:
--   1. CREATE OR REPLACE de answer_question_atomic e reply_review_atomic
--      com recipient_count = 0 (assinatura intacta);
--   2. UPDATE de limpeza: linhas com os títulos da pergunta/avaliação e
--      count = 1 voltaram para 0.
--
-- O que este rollback desfaz: o item 1 — restaura os corpos com `1`
-- (estado exato anterior, extraído do banco vivo antes da migration).
--
-- O que este rollback NÃO desfaz (de mão única, de propósito): o item 2.
-- As linhas antigas permanecem com 0 — rementir-las recriaria o defeito;
-- não há cenário em que isso seja desejado. Se ainda assim quiser as
-- linhas de volta em 1, o UPDATE inverso é espelhado no fim do arquivo,
-- COMENTADO.
--
-- Rodar por transação própria (psql \i, DBeaver etc.). NUNCA `supabase db push`.

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
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can answer questions.';
    END IF;

    INSERT INTO public.answers (question_id, user_id, answer)
    VALUES (p_question_id, p_admin_id, p_answer)
    ON CONFLICT (question_id) DO UPDATE
       SET answer     = EXCLUDED.answer,
           user_id    = EXCLUDED.user_id,
           created_at = timezone('utc', now());

    SELECT user_id, product_id INTO v_user_id, v_product_id
    FROM public.questions WHERE id = p_question_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM public.produtos WHERE id = v_product_id;

        INSERT INTO public.push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua pergunta foi respondida!',
            'A loja respondeu a sua pergunta sobre o produto ' || COALESCE(v_product_name, 'selecionado') || '.',
            '/product/' || v_product_id,
            1,
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
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can reply to reviews.';
    END IF;

    UPDATE public.reviews
    SET merchant_reply = p_reply, merchant_reply_at = NOW()
    WHERE id = p_review_id
    RETURNING user_id, product_id INTO v_user_id, v_product_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM public.produtos WHERE id = v_product_id;

        INSERT INTO public.push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua avaliacao foi respondida!',
            'A loja respondeu a sua avaliacao no produto ' || COALESCE(v_product_name, 'comprado') || '.',
            '/product/' || v_product_id,
            1,
            p_admin_id
        );
    END IF;
END;
$function$;

-- INVERSO da limpeza — SÓ se quiser recriar a mentira (não há cenário):
-- UPDATE public.push_notifications_log
--    SET recipient_count = 1
--  WHERE recipient_count = 0
--    AND title IN ('Sua pergunta foi respondida!',
--                  'Sua avaliacao foi respondida!',
--                  'Sua avaliação foi respondida!');
