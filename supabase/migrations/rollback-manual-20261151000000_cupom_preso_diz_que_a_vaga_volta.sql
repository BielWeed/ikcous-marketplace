-- ROLLBACK MANUAL da 20261151000000_cupom_preso_diz_que_a_vaga_volta.sql
-- (a frase canônica de vaga presa nas três funções de recusa de cupom)
--
-- DUAS PARTES, cada uma com a fonte do corpo anterior:
--
-- PARTE 1 — v23 e v24: NÃO HÁ SQL NECESSÁRIO NESTE ARQUIVO. O corpo
-- anterior delas (assinatura VIVA de 13 argumentos, com a chave de
-- idempotência) está INTEIRO na
-- 20261081000000_a_regra_do_frete_gratis_mora_no_servidor.sql — o ÚLTIMO
-- escritor vivo das duas, que toca SÓ elas (DROP IF EXISTS do overload de
-- 12 args + CREATE OR REPLACE). O desfazer é re-aplicar aquele arquivo:
--
--   node scripts/db-apply.cjs \
--     supabase/migrations/20261081000000_a_regra_do_frete_gratis_mora_no_servidor.sql
--
-- (ou colar o conteúdo dele no SQL editor do Supabase)
--
-- ⚠️ NÃO é a 20261025000000: a assinatura de 12 argumentos daquela era foi
-- DROPADA do banco vivo (20261040000000/20261081000000) — re-aplicá-la
-- recriaria um overload-sombra sem a guarda de idempotência.
--
-- EFEITO COLATERAL HONESTO da parte 1: a recusa por limite volta a não
-- distinguir "esgotado de verdade" de "vaga presa" — o GAP 2 volta — e a
-- regra nova em src/lib/recusaDoPedido.ts fica DORMENTE (a âncora
-- recusa-do-pedido-ancora-nas-migrations.test.ts lê o ARQUIVO da migration
-- em disco, não o banco, e continuaria passando; o veredito de
-- migração-aplicada é do banco). Nada quebra alto.
--
-- PARTE 2 — validate_coupon_secure_v2: a fonte do corpo anterior é o
-- BASELINE (20260806000000, l.3714-3754), e re-processar o baseline inteiro
-- NÃO é caminho. O corpo anterior está EMBUTIDO ABAIXO — rode este bloco
-- para restaurá-lo (CREATE OR REPLACE idempotente).
--
-- EFEITO COLATERAL HONESTO da parte 2: a validação antecipada do carrinho
-- volta a dizer "Cupom atingiu o limite de uso." para todo caso-limite,
-- inclusive o de vaga presa (GAP 2 reaberto na porta antecipada).

CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code text, p_subtotal numeric) RETURNS jsonb
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

-- Grants da parte 2, com o mesmo cuidado da migration: estado vivo
-- (20261090500000) preservado.
REVOKE EXECUTE ON FUNCTION public.validate_coupon_secure_v2(text,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_coupon_secure_v2(text,numeric) TO anon, authenticated;
