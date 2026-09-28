-- ============================================================================
-- Rollback manual — O checkout mostra os cupons da cliente (20261187000000)
-- ============================================================================
-- Desfaz na ordem inversa. SEM BEGIN/COMMIT (regra da casa) — rode pelo
-- workflow ou num `psql -1`, que já é uma transação só.
--
-- ATENÇÃO (decisão do dono antes de rodar): cupons 'vitrine' voltam a ser
-- secretos (somem do checkout) e cupons 'exclusivo' viram cupons de código
-- comum — QUALQUER pessoa com o código passa a poder usar. Por isso o passo 1
-- DESATIVA os exclusivos antes de apagar a coluna: a volta nunca abre um
-- exclusivo para todo mundo em silêncio. Reative à mão, depois de conferir,
-- o que fizer sentido.

-- 1. Exclusivo nunca vira público na volta.
UPDATE public.coupons SET active = false WHERE alcance = 'exclusivo';

-- 2. A lista do checkout e as RPCs do painel.
DROP FUNCTION IF EXISTS public.cupons_do_checkout(numeric);
DROP FUNCTION IF EXISTS public.admin_cupom_clientes(uuid);
DROP FUNCTION IF EXISTS public.admin_cupom_definir_clientes(uuid, uuid[]);

-- 3. O gatilho do pedido.
DROP TRIGGER IF EXISTS tr_cupom_do_pedido_vale_para_quem_compra ON public.marketplace_orders;
DROP FUNCTION IF EXISTS public.cupom_do_pedido_vale_para_quem_compra();

-- 4. A validação volta ao corpo do baseline, VERBATIM (CREATE OR REPLACE
-- mantém os grants de hoje: anon e authenticated).
CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2("p_code" "text", "p_subtotal" numeric) RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
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

-- 5. A lista de clientes e a coluna.
DROP TABLE IF EXISTS public.cupom_clientes;
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_alcance_check;
ALTER TABLE public.coupons DROP COLUMN IF EXISTS alcance;
