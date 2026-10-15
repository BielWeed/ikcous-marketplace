-- ROLLBACK MANUAL de 20261240000000_a_cliente_e_avisada_quando_a_loja_responde_sua_pergunta.sql
--
-- Recria, byte a byte, os dois corpos de antes (os vigentes das migrations 20261065000000 e 20261064000000):
--   answer_question_atomic(uuid, text)        md5 do corpo sem CR = 8cf000b6c9ed27f482906752469f08ff
--   answer_question_atomic(uuid, text, uuid)  md5 do corpo sem CR = ad99d54575ac95445103ea5b78e4a1e8
-- Isso VOLTA o defeito: a resposta passa a gravar de novo a linha falsa em push_notifications_log e a cliente
-- deixa de ser avisada no sino. Os avisos já criados em `notificacoes` ficam (são avisos verdadeiros).
-- SEM BEGIN/COMMIT (aplicar pelo mesmo caminho da migration: o db-apply abre a transação).
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se `answer_question_atomic` não tiver EXATAMENTE as duas assinaturas
-- acima em public, ou se o corpo vivo de qualquer uma não for um dos dois conhecidos: o desta migration
-- (1268df6cb364dfb46b5c535e007bb2d0 e b62a4186ff8d58955973f53d6c0f302b, e então desfaz) ou o de antes (já
-- desfeito: rodar de novo reescreve o mesmo texto). Qualquer outro corpo significa que alguém redefiniu a função
-- DEPOIS desta migration: desfazer por cima apagaria a trava nova em silêncio. A conferência final recusa se algum
-- dos dois corpos não voltou ao de antes. Dono, ACL, atributos e assinatura não são tocados (CREATE OR REPLACE os
-- preserva; este arquivo não tem GRANT nem REVOKE).
--
-- ORDEM: se o front desta release já está no ar, desfaça o front ANTES (a caixa de resposta do painel diz "Avisa a
-- cliente no app", e depois deste rollback isso volta a ser falso). Passo a passo no item 41 de
-- docs/runbooks/producao-unica-fonte.md.

DO $preflight_rollback_20261240$
DECLARE
  r record;
  v_hash text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'answer_question_atomic') <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: answer_question_atomic não tem exatamente as duas assinaturas esperadas em public ((uuid,text) e (uuid,text,uuid)) — revise antes de devolver os corpos de antes.';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('public.answer_question_atomic(uuid,text)',      '1268df6cb364dfb46b5c535e007bb2d0', '8cf000b6c9ed27f482906752469f08ff'),
      ('public.answer_question_atomic(uuid,text,uuid)', 'b62a4186ff8d58955973f53d6c0f302b', 'ad99d54575ac95445103ea5b78e4a1e8')
    ) AS esperado(assinatura, hash_desta, hash_antes)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_desta, r.hash_antes) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o desta migration nem o de antes — uma redefinição posterior está no ar; revise antes de sobrescrever.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
END $preflight_rollback_20261240$;

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

-- CONFERÊNCIA FINAL: as duas sobrecargas (e só elas) voltaram ao corpo de antes, byte a byte (hash).
-- ACL e atributos não são comparados aqui: o CREATE OR REPLACE os preserva e a 41a/41b os medem.
DO $conferencia_rollback_20261240$
DECLARE
  r record;
  v_hash text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'answer_question_atomic') <> 2 THEN
    RAISE EXCEPTION 'conferencia rollback 20261240: answer_question_atomic não ficou com exatamente as duas assinaturas esperadas';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('public.answer_question_atomic(uuid,text)',      '8cf000b6c9ed27f482906752469f08ff'),
      ('public.answer_question_atomic(uuid,text,uuid)', 'ad99d54575ac95445103ea5b78e4a1e8')
    ) AS esperado(assinatura, hash_antes)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS DISTINCT FROM r.hash_antes THEN
      RAISE EXCEPTION 'conferencia rollback 20261240: corpo vivo de % (hash %) não voltou ao de antes (esperado %)', r.assinatura, COALESCE(v_hash, 'ausente'), r.hash_antes;
    END IF;
  END LOOP;
END $conferencia_rollback_20261240$;
