-- ============================================================================
-- Rollback manual -- os cupons desligados nao dao desconto (20261203000000)
-- ============================================================================
-- Restaura, BYTE A BYTE, o corpo de `public.validate_coupon_secure_v2` que o
-- baseline 20260806000000 deixou (nenhuma migration a tinha redefinido) e
-- remove o gatilho `tr_pedido_com_cupom_exige_a_chave_ligada` e a funcao dele.
-- ACL intocada (CREATE OR REPLACE preserva). Nenhuma linha de dado e' tocada.
--
-- O QUE VOLTA A VALER: a chave `enable_coupons` em FALSO volta a so esconder o
-- campo -- o desconto de cupom volta a entrar em pedido novo (issue #645).
--
-- GUARDA DE ORDEM: so restaura se o corpo vivo for o desta migration ou ja o
-- do baseline (LF | CRLF) -- rollback repetido e' idempotente. Qualquer outro
-- corpo e' de uma migration POSTERIOR: restaurar por baixo apagaria a guarda
-- dela em silencio.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply). Sem BEGIN/COMMIT de nivel
-- superior neste arquivo -- regra da casa.
-- ============================================================================

DO $guarda_rollback_20261203000000$
DECLARE
  v_hash text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.validate_coupon_secure_v2(text, numeric)');
  IF v_hash IS NULL OR v_hash NOT IN (
    '489c0cd19b3529ef2d9cf341096ee9b0048e5787ff0a2d0a918df4db580e82f3',
    '4b096e67be79665d70e86ff5e94953ecf5842cd64abca882abac0f6cbe328279',
    '5fefbbe6648d44e9f6837b2a6f24d8a5223060f55b8a67fa68c223a15ab742d7',
    'b325866f6648a0f97d13d894c823a89e1ff2a6682d49db3d25816cef358eaddc'
  ) THEN
    RAISE EXCEPTION 'corpo vivo de validate_coupon_secure_v2 (hash %) nao e o da 20261203000000 nem o do baseline -- uma migration posterior o redefiniu; reverta-a antes.', COALESCE(v_hash, 'ausente');
  END IF;
END $guarda_rollback_20261203000000$;

DROP TRIGGER IF EXISTS tr_pedido_com_cupom_exige_a_chave_ligada ON public.marketplace_orders;
DROP FUNCTION IF EXISTS public.pedido_com_cupom_exige_a_chave_ligada();

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
BEGIN
    -- Fix: Standardize case-insensitive matching
    SELECT * INTO v_coupon FROM public.coupons 
    WHERE UPPER(code) = UPPER(p_code) AND active = true;

    IF v_coupon.id IS NULL THEN
        v_error := 'Cupom inválido ou expirado.';
    ELSIF v_coupon.valid_until IS NOT NULL AND v_coupon.valid_until < NOW() THEN
        v_error := 'Este cupom expirou.';
    ELSIF (v_coupon.usage_limit IS NOT NULL AND v_coupon.usage_limit > 0) AND v_coupon.usage_count >= v_coupon.usage_limit THEN
        v_error := 'Cupom atingiu o limite de uso.';
    ELSIF v_coupon.min_purchase IS NOT NULL AND p_subtotal < v_coupon.min_purchase THEN
        v_error := 'Valor mínimo não atingido.';
    ELSE
        v_is_valid := TRUE;
        IF v_coupon.type = 'percentage' THEN
            v_discount := (p_subtotal * v_coupon.value) / 100;
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
