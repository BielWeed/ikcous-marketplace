-- A SOBRECARGA QUE O APP USA TAMBÉM NASCE HONESTA (laudo novos ângulos
-- 01/09, achado A10 — complemento da 20261064000000).
--
-- POR QUE ESTA MIGRATION EXISTE: a 64 consertou as sobrecargas de 3 args
-- (`p_admin_id` explícito). A ficha da frente pegou que O FRONT CHAMA AS
-- DUAS RPCs COM 2 ARGS (useQuestions.ts:311 e useReviews.ts:601 — sem
-- `p_admin_id`; quem resolve o admin dentro da função é `auth.uid()`), ou
-- seja: o CAMINHO VIVO do app continuava gravando `recipient_count = 1`
-- sem enviar push nenhum. As sobrecargas de 2 args não são código morto —
-- são o caminho que o painel usa.
--
-- O QUE ESTA MIGRATION FAZ: CREATE OR REPLACE das DUAS sobrecargas de
-- 2 args (assinatura INTACTA) com `recipient_count = 0` e o
-- comentário-marcador "A10: log honesto" no corpo. Reaproveita a limpeza
-- de linhas mentirosas da 64 em forma idempotente (nenhuma linha nova
-- pode ter nascido mentindo entre uma migration e outra — e se nasceu,
-- volta para 0 aqui).
--
-- SEM BEGIN/COMMIT (regra da casa: o db-apply abre a transação).
--
-- FICHA DE VERIFICAÇÃO pos-aplicação: scripts/db-prove-push-log-honesto.cjs
-- (agora prova AS QUATRO assinaturas: o caminho de 2 args que o app usa E
-- o de 3 args legado — ambas gravam 0).
--
-- ROLLBACK MANUAL: versionado em
-- rollback-manual-20261065000000_a_sobrecarga_que_o_app_usa_tambem_nasce_honesta.sql

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

CREATE OR REPLACE FUNCTION public.reply_review_atomic(p_review_id uuid, p_reply text)
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
        RAISE EXCEPTION 'Unauthorized: Only admins can reply to reviews.';
    END IF;

    -- 1. Update Review
    UPDATE reviews
    SET merchant_reply = p_reply, merchant_reply_at = NOW()
    WHERE id = p_review_id
    RETURNING user_id, product_id INTO v_user_id, v_product_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM produtos WHERE id = v_product_id;

        -- 2. Log Notification for Admin Visibility — A10: log honesto,
        --    nasce com 0; só sobe quando o send-push CONFIRMAR entrega.
        INSERT INTO push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua avaliação foi respondida!',
            'A loja respondeu à sua avaliação no produto ' || COALESCE(v_product_name, 'comprado') || '.',
            '/product/' || v_product_id,
            0,
            v_admin_id
        );
    END IF;
END;
$function$;

-- Idempotente: se alguma linha mentirosa nasceu entre a 64 e esta
-- migration (caminho de 2 args ainda sujo), volta para 0 aqui.
UPDATE public.push_notifications_log
   SET recipient_count = 0
 WHERE recipient_count = 1
   AND title IN ('Sua pergunta foi respondida!',
                 'Sua avaliacao foi respondida!',
                 'Sua avaliação foi respondida!');
