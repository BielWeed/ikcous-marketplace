-- Rollback manual da 20261405800000: restaura a conferência anterior, sem tocar pedidos ou cupons.
-- Corpo anterior (20261397000000), MD5 sem CR: 61b90bb7f7c9729abeb94b5596914eb4
-- Corpo novo (20261405800000), MD5 sem CR: 98ccd81ae2e6440dd0c5378910736d0b
-- Só parte do corpo que esta migration instalou.
-- PUBLIC continua sem EXECUTE, authenticated mantém EXECUTE; a fotografia preserva o restante da ACL.
-- O aplicador controla a transação e o ledger.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $prevoo_4058_rb$
DECLARE
  v_hash text;
  v_foto jsonb;
BEGIN
  SELECT md5(replace(p.prosrc, chr(13), '')), to_jsonb(p) - 'prosrc'
    INTO v_hash, v_foto
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.validate_coupon_secure_v2(text,numeric)')
     AND (SELECT count(*) FROM pg_proc q
       WHERE q.pronamespace = 'public'::regnamespace
         AND q.proname = 'validate_coupon_secure_v2') = 1
     AND p.prokind = 'f'
     AND p.prosecdef
     AND p.provolatile = 'v'
     AND NOT p.proisstrict
     AND NOT p.proretset
     AND l.lanname = 'plpgsql'
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND pg_get_function_arguments(p.oid) = 'p_code text, p_subtotal numeric'
     AND p.prorettype = 'jsonb'::regtype
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (
       SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
     );
  IF v_hash IS DISTINCT FROM '98ccd81ae2e6440dd0c5378910736d0b' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo, atributos ou ACL de validate_coupon_secure_v2 divergentes (hash %).',
      COALESCE(v_hash, 'ausente ou incompatível');
  END IF;
  PERFORM set_config('ikcous.foto_20261405800000_rb', v_foto::text, true);
END $prevoo_4058_rb$;

-- Preserve os espaços finais herdados no corpo: fazem parte do hash.
CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code text, p_subtotal numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
    v_coupon RECORD;
    v_discount NUMERIC := 0;
    v_is_valid BOOLEAN := FALSE;
    v_error TEXT := '';
    v_uid uuid := auth.uid();
BEGIN
    -- CUPONS DESLIGADOS (issue #645, decisao do dono em 08/10/2026): com a
    -- chave store_config.enable_coupons em FALSO a validacao recusa antes de
    -- olhar o cupom -- nenhum codigo vale, nem o de quem aplicou antes de o
    -- lojista desligar. So `IS FALSE` recusa: linha ausente ou NULL = default
    -- da coluna (true), o cupom continua valendo como sempre.
    IF EXISTS (SELECT 1 FROM public.store_config WHERE id = 1 AND enable_coupons IS FALSE) THEN
        RETURN jsonb_build_object(
            'is_valid', FALSE,
            'discount_value', 0,
            'error_message', 'Os cupons estão desativados nesta loja.'
        );
    END IF;

    -- Fix: Standardize case-insensitive matching
    SELECT * INTO v_coupon FROM public.coupons 
    WHERE UPPER(code) = UPPER(p_code) AND active = true;

    -- CUPOM EXCLUSIVO (20261208000000): o exclusivo de OUTRA conta (ou de quem nao
    -- tem conta) responde exatamente como "nao existe", ANTES de qualquer outro
    -- motivo -- nem "expirou" nem "faltam R$" revelam que o codigo existe para outra
    -- pessoa. Exclusivo com a lista vazia vale para ninguem (falha fechada).
    IF v_coupon.id IS NULL
       OR (v_coupon.alcance = 'exclusivo' AND (
             v_uid IS NULL
             OR NOT EXISTS (
               SELECT 1 FROM public.cupom_clientes cc
                WHERE cc.coupon_id = v_coupon.id AND cc.user_id = v_uid
             )
          )) THEN
        v_error := 'Cupom inválido ou expirado.';
    ELSIF v_coupon.valid_until IS NOT NULL AND v_coupon.valid_until <= NOW() THEN
        v_error := 'Este cupom expirou.';
    ELSIF (v_coupon.usage_limit IS NOT NULL AND v_coupon.usage_limit > 0) AND v_coupon.usage_count >= v_coupon.usage_limit THEN
        v_error := 'Cupom atingiu o limite de uso.';
    ELSIF v_coupon.min_purchase IS NOT NULL AND p_subtotal < v_coupon.min_purchase THEN
        v_error := 'Faltam R$ '
          || translate(to_char(v_coupon.min_purchase - p_subtotal, 'FM999999999990.00'), '.', ',')
          || ' em produtos para usar este cupom (mínimo de R$ '
          || translate(to_char(v_coupon.min_purchase, 'FM999999999990.00'), '.', ',')
          || ').';
    ELSE
        v_is_valid := TRUE;
        IF v_coupon.type = 'percentage' THEN
            v_discount := round((p_subtotal * v_coupon.value) / 100, 2);
        ELSE
            v_discount := v_coupon.value;
        END IF;
        
        -- Cap discount at subtotal
        IF v_discount > p_subtotal THEN v_discount := p_subtotal; END IF;
    END IF;

    RETURN jsonb_build_object(
        'is_valid', v_is_valid,
        'discount_value', v_discount,
        'error_message', v_error
    );
END;
$$;

DO $posvoo_4058_rb$
DECLARE
  v_hash text;
  v_foto jsonb;
  v_marca constant text := 'IF v_discount <= 0 THEN';
  v_src text;
BEGIN
  SELECT md5(replace(p.prosrc, chr(13), '')), to_jsonb(p) - 'prosrc', p.prosrc
    INTO v_hash, v_foto, v_src
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.validate_coupon_secure_v2(text,numeric)')
     AND (SELECT count(*) FROM pg_proc q
       WHERE q.pronamespace = 'public'::regnamespace
         AND q.proname = 'validate_coupon_secure_v2') = 1
     AND p.prokind = 'f'
     AND p.prosecdef
     AND p.provolatile = 'v'
     AND NOT p.proisstrict
     AND NOT p.proretset
     AND l.lanname = 'plpgsql'
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND pg_get_function_arguments(p.oid) = 'p_code text, p_subtotal numeric'
     AND p.prorettype = 'jsonb'::regtype
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (
       SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
     );
  IF v_hash IS DISTINCT FROM '61b90bb7f7c9729abeb94b5596914eb4'
     OR (length(v_src) - length(replace(v_src, v_marca, ''))) / length(v_marca) IS DISTINCT FROM 0
     OR v_foto IS DISTINCT FROM NULLIF(current_setting('ikcous.foto_20261405800000_rb', true), '')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_20261405800000: corpo, marca, identidade, atributos ou ACL de validate_coupon_secure_v2 divergentes.';
  END IF;
END $posvoo_4058_rb$;

NOTIFY pgrst, 'reload schema';
