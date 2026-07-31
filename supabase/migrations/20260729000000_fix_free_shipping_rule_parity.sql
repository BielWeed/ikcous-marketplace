-- =============================================================================
-- Paridade da regra de frete grátis entre frontend e banco
-- =============================================================================
--
-- PROBLEMA 1 — convidado não conseguia fechar pedido
--   O frontend só zera o frete quando há usuário logado (CartContext.tsx: a
--   condição inclui `&& user`), e a UI comunica isso explicitamente
--   ("Faça login para ganhar frete grátis em suas compras" em FreeShippingBlock).
--   A RPC, porém, zerava o frete apenas pelo subtotal, sem olhar autenticação.
--   Resultado: convidado com carrinho acima do mínimo enviava
--   `subtotal + frete`, o banco calculava só `subtotal`, e o guard de
--   divergência (> R$ 0,05) derrubava o pedido. O cliente nunca comprava.
--
-- PROBLEMA 2 — desligar o frete grátis derrubava TODOS os checkouts
--   `COALESCE(free_shipping_min, 999999)` só trata NULL. O toggle do admin
--   (AdminShippingView) grava 0 quando o lojista desliga a regra. Com 0,
--   `subtotal >= 0` é sempre verdadeiro e o banco zerava o frete para todo
--   mundo, enquanto o front (que trata `> 0` como "regra ligada") continuava
--   cobrando. Divergência em 100% dos pedidos, inclusive de usuários logados.
--   NULLIF(x, 0) faz o 0 cair no COALESCE e virar "regra desligada", igual ao front.
--
-- PROBLEMA 3 — mensagem de erro incompreensível para o cliente
--   A exceção de divergência expunha números crus ("Calculado: 400,
--   Fornecido: 415"). Agora a mensagem é acionável e os números vão no DETAIL,
--   que continua disponível para depuração via `error.details` no cliente JS.
--
-- ESCOPO: só a etapa 4 (cálculo de frete) e a mensagem da etapa 6 mudaram.
-- O restante do corpo é idêntico a 20260526000000_coupon_percentage_fixes.sql.
--
-- NÃO RESOLVIDO AQUI (fica para a correção do frete por transportadora):
--   `p_shipping_cost` continua sendo recebido e ignorado. Quando o cliente
--   escolher uma opção de transportadora (ex.: PAC R$ 27,40) diferente da
--   `shipping_fee` padrão da loja, a divergência volta a acontecer. Isso exige
--   validar a cotação escolhida contra shipping_quotes_cache no servidor.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_marketplace_order_v22(
    p_items JSONB,
    p_total_amount NUMERIC,
    p_shipping_cost NUMERIC,
    p_payment_method TEXT,
    p_address_id UUID,
    p_coupon_code TEXT,
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_observation TEXT,
    p_address_data JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_order_id uuid;
    v_item jsonb;
    v_product_id uuid;
    v_variant_id uuid;
    v_quantity integer;
    v_item_name text;
    v_rows_affected integer;

    v_db_price numeric;
    v_db_stock integer;
    v_calculated_subtotal numeric := 0;
    v_calculated_total numeric := 0;
    v_discount_amount numeric := 0;
    v_coupon_id uuid;

    v_store_config RECORD;
    v_shipping_validated numeric;
    v_frete_gratis boolean;
    v_has_free_shipping_item boolean := false;
    v_free_shipping_min numeric;

    v_coupon_type text;
    v_coupon_val numeric;
BEGIN
    -- 0. Auth Check (REMOVED for Guest Checkout)
    -- IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

    -- 1. Address Ownership Check (Only if user is logged in)
    IF p_address_id IS NOT NULL AND v_user_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN
            RAISE EXCEPTION 'Endereço inválido ou não pertence ao usuário.';
        END IF;
    END IF;

    -- 2. Store Config
    SELECT * INTO v_store_config FROM public.store_config WHERE id = 1;

    -- 3. Validation Loop (Price, Stock Lock, Subtotal Calculation)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;

        IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida para um dos itens.'; END IF;

        IF v_variant_id IS NOT NULL THEN
            SELECT COALESCE(v.price_override, p.preco_venda), v.stock_increment, p.nome, p.frete_gratis
            INTO v_db_price, v_db_stock, v_item_name, v_frete_gratis
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id AND p.id = v_product_id
              AND v.active = true AND p.ativo = true
            FOR NO KEY UPDATE OF v;
        ELSE
            SELECT preco_venda, estoque, nome, frete_gratis
            INTO v_db_price, v_db_stock, v_item_name, v_frete_gratis
            FROM public.produtos
            WHERE id = v_product_id AND ativo = true
            FOR NO KEY UPDATE;
        END IF;

        IF v_db_price IS NULL THEN RAISE EXCEPTION 'Produto % não disponível.', COALESCE(v_item_name, 'não encontrado'); END IF;
        IF v_db_stock < v_quantity THEN
            RAISE EXCEPTION 'Estoque insuficiente para o produto % (Disponível: %, Solicitado: %)', v_item_name, v_db_stock, v_quantity;
        END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_db_price * v_quantity);
        IF v_frete_gratis = true THEN
            v_has_free_shipping_item := true;
        END IF;
    END LOOP;

    -- 4. Shipping Calculation  [ALTERADO]
    -- NULLIF(..., 0): 0 significa "regra desligada", exatamente como no frontend.
    v_free_shipping_min := COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 999999);

    IF v_has_free_shipping_item = true
       OR (v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min)
    THEN
        v_shipping_validated := 0;
    ELSE
        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);
    END IF;

    -- 5. Coupon Validation
    IF p_coupon_code IS NOT NULL AND p_coupon_code != '' THEN
        SELECT id, value, type INTO v_coupon_id, v_coupon_val, v_coupon_type
        FROM public.coupons
        WHERE UPPER(code) = UPPER(p_coupon_code)
          AND active = true
          AND (valid_until IS NULL OR valid_until > now())
          AND (usage_limit IS NULL OR usage_count < usage_limit)
          AND (min_purchase IS NULL OR v_calculated_subtotal >= min_purchase)
          FOR UPDATE;

        IF v_coupon_id IS NULL THEN
            RAISE EXCEPTION 'Cupom % inválido ou expirado.', p_coupon_code;
        END IF;

        IF v_coupon_type = 'percentage' THEN
            v_discount_amount := (v_calculated_subtotal * v_coupon_val) / 100;
        ELSE
            v_discount_amount := v_coupon_val;
        END IF;

        -- Cap discount at subtotal
        IF v_discount_amount > v_calculated_subtotal THEN
            v_discount_amount := v_calculated_subtotal;
        END IF;
    END IF;

    v_calculated_total := GREATEST(0, v_calculated_subtotal + v_shipping_validated - v_discount_amount);

    -- 6. Price Tampering Protection  [MENSAGEM ALTERADA]
    IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN
        RAISE EXCEPTION 'Os valores do pedido mudaram. Atualize o carrinho e tente novamente.'
            USING DETAIL = format(
                'Divergência de total. Calculado: %s (subtotal %s + frete %s - desconto %s), Fornecido: %s. Autenticado: %s.',
                v_calculated_total, v_calculated_subtotal, v_shipping_validated,
                v_discount_amount, p_total_amount, (v_user_id IS NOT NULL)
            );
    END IF;

    -- 7. Create Order Header
    INSERT INTO public.marketplace_orders (
        user_id, total, shipping, payment_method, address_id,
        coupon_id, status, notes, customer_name, customer_data,
        subtotal, discount, coupon_code
    ) VALUES (
        v_user_id, v_calculated_total, v_shipping_validated, p_payment_method, p_address_id,
        v_coupon_id, 'pending', p_observation, p_customer_name,
        jsonb_build_object('whatsapp', p_customer_phone, 'address_id', p_address_id, 'address', p_address_data),
        v_calculated_subtotal, v_discount_amount, p_coupon_code
    ) RETURNING id INTO v_order_id;

    -- 8. Atomic Inventory Update and Order Items Insertion
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;

        IF v_variant_id IS NOT NULL THEN
            UPDATE public.product_variants
            SET stock_increment = stock_increment - v_quantity
            WHERE id = v_variant_id AND stock_increment >= v_quantity;

            GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
            IF v_rows_affected = 0 THEN
                SELECT p.nome INTO v_item_name FROM public.produtos p JOIN public.product_variants v ON v.product_id = p.id WHERE v.id = v_variant_id;
                RAISE EXCEPTION 'Estoque insuficiente para o produto %', v_item_name;
            END IF;

            SELECT COALESCE(v.price_override, p.preco_venda), p.nome
            INTO v_db_price, v_item_name
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id;
        ELSE
            UPDATE public.produtos
            SET estoque = estoque - v_quantity
            WHERE id = v_product_id AND estoque >= v_quantity;

            GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
            IF v_rows_affected = 0 THEN
                SELECT nome INTO v_item_name FROM public.produtos WHERE id = v_product_id;
                RAISE EXCEPTION 'Estoque insuficiente para o produto %', v_item_name;
            END IF;

            SELECT preco_venda, nome INTO v_db_price, v_item_name FROM public.produtos WHERE id = v_product_id;
        END IF;

        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, quantity, price, product_name
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price, v_item_name
        );
    END LOOP;

    -- 9. Coupon Usage Update
    IF v_coupon_id IS NOT NULL THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_id;
    END IF;

    RETURN v_order_id;
END;
$function$;

-- Grants preservados (CREATE OR REPLACE mantém a ACL, mas reafirmamos por segurança).
GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v22(
    JSONB, NUMERIC, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB
) TO anon, authenticated, service_role;
