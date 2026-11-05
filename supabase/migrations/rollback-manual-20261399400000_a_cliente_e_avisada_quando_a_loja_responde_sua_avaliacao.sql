-- ROLLBACK MANUAL de 20261399400000_a_cliente_e_avisada_quando_a_loja_responde_sua_avaliacao.sql
--
-- Recria, byte a byte, os dois corpos de antes (os vigentes da migration 20261360000000):
--   reply_review_atomic(uuid, text)        md5 do corpo sem CR = 0e58549366e4b4be17ae070a8fc622dc
--   reply_review_atomic(uuid, text, uuid)  md5 do corpo sem CR = 64b337eb3ec5dd1431e0dbf9d12a49ac
-- Isso VOLTA o defeito: a resposta da loja passa a só gravar a resposta e a linha do log de push, e a cliente deixa de
-- ser avisada no sino. Os avisos já criados em notificacoes ficam (são avisos verdadeiros).
-- SEM BEGIN/COMMIT (aplicar pelo mesmo caminho da migration: o db-apply abre a transação).
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se reply_review_atomic não tiver EXATAMENTE as duas assinaturas acima em
-- public, ou se o corpo vivo de qualquer uma não for um dos dois conhecidos: o desta migration (f617966c37037537410c3c78d85b8785 e
-- 08569f17f477dea9ff87709ca3edd218, e então desfaz) ou o de antes (já desfeito: rodar de novo reescreve o mesmo texto). Qualquer outro corpo
-- significa que alguém redefiniu a função DEPOIS desta migration: desfazer por cima apagaria a mudança nova em
-- silêncio. A conferência final recusa se algum dos dois corpos não voltou ao de antes. Dono, ACL, atributos e
-- assinatura não são tocados (CREATE OR REPLACE os preserva; este arquivo não tem GRANT nem REVOKE).
--
-- ORDEM: nenhuma mudança de front acompanha esta migration (a tela de avaliações não promete aviso à cliente), então o
-- rollback pode rodar sozinho. Se a 20261360000000 também for desfeita, desfaça ESTA primeiro: o rollback da 1360 só
-- aceita o corpo da 1360 ou o de antes dela.

DO $preflight_rollback_20261399400$
DECLARE
  r record;
  v_hash text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'reply_review_atomic') <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: reply_review_atomic não tem exatamente as duas assinaturas esperadas em public ((uuid,text) e (uuid,text,uuid)) — revise antes de devolver os corpos de antes.';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('public.reply_review_atomic(uuid,text)',      'f617966c37037537410c3c78d85b8785', '0e58549366e4b4be17ae070a8fc622dc'),
      ('public.reply_review_atomic(uuid,text,uuid)', '08569f17f477dea9ff87709ca3edd218', '64b337eb3ec5dd1431e0dbf9d12a49ac')
    ) AS esperado(assinatura, hash_desta, hash_antes)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_desta, r.hash_antes) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o desta migration nem o de antes — uma redefinição posterior está no ar; revise antes de sobrescrever.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
END $preflight_rollback_20261399400$;

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
    IF NOT public.is_admin_atual() THEN
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
    IF NOT public.is_admin_atual() THEN
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

-- CONFERÊNCIA FINAL: as duas sobrecargas (e só elas) voltaram ao corpo de antes, byte a byte (hash).
-- ACL e atributos não são comparados aqui: o CREATE OR REPLACE os preserva e a 120a/120b os medem.
DO $conferencia_rollback_20261399400$
DECLARE
  r record;
  v_hash text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'reply_review_atomic') <> 2 THEN
    RAISE EXCEPTION 'conferencia rollback 20261399400: reply_review_atomic não ficou com exatamente as duas assinaturas esperadas';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('public.reply_review_atomic(uuid,text)',      '0e58549366e4b4be17ae070a8fc622dc'),
      ('public.reply_review_atomic(uuid,text,uuid)', '64b337eb3ec5dd1431e0dbf9d12a49ac')
    ) AS esperado(assinatura, hash_antes)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS DISTINCT FROM r.hash_antes THEN
      RAISE EXCEPTION 'conferencia rollback 20261399400: corpo vivo de % (hash %) não voltou ao de antes (esperado %)', r.assinatura, COALESCE(v_hash, 'ausente'), r.hash_antes;
    END IF;
  END LOOP;
END $conferencia_rollback_20261399400$;
