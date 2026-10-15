-- ROLLBACK MANUAL de 20261240000000_a_cliente_e_avisada_quando_a_loja_responde_sua_pergunta.sql
--
-- Recria, byte a byte, os dois corpos de antes (os vigentes das migrations 20261065000000 e 20261064000000):
--   answer_question_atomic(uuid, text)        md5 do corpo sem CR = 8cf000b6c9ed27f482906752469f08ff
--   answer_question_atomic(uuid, text, uuid)  md5 do corpo sem CR = ad99d54575ac95445103ea5b78e4a1e8
-- Isso VOLTA o defeito: a resposta passa a gravar de novo a linha falsa em push_notifications_log e a cliente
-- deixa de ser avisada no sino. Os avisos já criados em `notificacoes` ficam (são avisos verdadeiros).
-- SEM BEGIN/COMMIT (aplicar pelo mesmo caminho da migration: o db-apply abre a transação).

CREATE OR REPLACE FUNCTION public.answer_question_atomic(p_question_id uuid, p_answer text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
    v_admin_id uuid;
BEGIN
    -- SECURITY CHECK: Ensure the caller is an admin
    v_admin_id := auth.uid();
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can answer questions.';
    END IF;

    -- 1. Upsert Answer (idx_answers_question_id_unique, criado pela
    -- migration 20260812030000, e' quem permite o ON CONFLICT inferir o
    -- alvo)
    INSERT INTO answers (question_id, user_id, answer)
    VALUES (p_question_id, v_admin_id, p_answer)
    ON CONFLICT (question_id) DO UPDATE
       SET answer     = EXCLUDED.answer,
           user_id    = EXCLUDED.user_id,
           created_at = timezone('utc', now());

    -- 2. Get Question Info
    SELECT user_id, product_id INTO v_user_id, v_product_id
    FROM questions WHERE id = p_question_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM produtos WHERE id = v_product_id;

        -- 3. Log Notification — A10: log honesto, nasce com 0; só sobe
        --    quando o send-push CONFIRMAR entrega (contrato PUSH-010).
        INSERT INTO push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua pergunta foi respondida!',
            'A loja respondeu à sua pergunta sobre o produto ' || COALESCE(v_product_name, 'selecionado') || '.',
            '/product/' || v_product_id,
            0,
            v_admin_id
        );
    END IF;
END;
$function$;

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
