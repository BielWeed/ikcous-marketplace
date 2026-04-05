CREATE OR REPLACE FUNCTION public.create_marketplace_order_v9(p_items jsonb, p_payment_method text, p_address_id uuid, p_coupon_code text DEFAULT NULL::text, p_customer_name text DEFAULT NULL::text, p_customer_phone text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_user_id UUID := auth.uid();
    v_order_id UUID;
    v_item JSONB;
    v_product_id UUID;
    v_variant_id UUID;
    v_quantity INTEGER;
    v_current_price NUMERIC;
    v_current_cost NUMERIC;
    v_product_name TEXT;
    v_image_url TEXT;
    v_subtotal NUMERIC := 0;
    v_shipping_calc NUMERIC := 0;
    v_total_amount NUMERIC := 0;
    v_discount NUMERIC := 0;
    v_store_config RECORD;
    v_coupon_valid BOOLEAN;
    v_coupon_discount NUMERIC;
    v_coupon_error TEXT;
    v_address_owner UUID;
BEGIN
    -- 0. Auth Check
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Usuário não autenticado.');
    END IF;

    -- A. BOLA Check: Validar se o endereço pertence ao usuário
    SELECT user_id INTO v_address_owner FROM public.addresses WHERE id = p_address_id;
    IF v_address_owner IS NULL OR v_address_owner <> v_user_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Endereço inválido ou não pertence ao usuário.');
    END IF;

    -- B. Obter configurações da loja (Singleton ID=1)
    SELECT * INTO v_store_config FROM public.store_config WHERE id = 1;

    -- C. Loop para Validação de Preço e Cálculo de Subtotal (Server-side Truth)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_variant_id := (v_item->>'variant_id')::UUID;
        v_quantity := (v_item->>'quantity')::INTEGER;

        IF v_quantity <= 0 THEN
            RAISE EXCEPTION 'Quantidade inválida para o produto %', v_product_id;
        END IF;

        -- Buscar dados reais do DB com bloqueio para evitar race condition
        IF v_variant_id IS NOT NULL THEN
            SELECT 
                p.nome, p.imagem_url,
                COALESCE(v.price_override, p.preco_venda), 
                COALESCE(p.custo, 0)
            INTO v_product_name, v_image_url, v_current_price, v_current_cost
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id AND p.id = v_product_id
            FOR NO KEY UPDATE OF v; -- Bloqueio específico da variante
        ELSE
            SELECT nome, imagem_url, preco_venda, COALESCE(custo, 0)
            INTO v_product_name, v_image_url, v_current_price, v_current_cost
            FROM public.produtos
            WHERE id = v_product_id
            FOR NO KEY UPDATE; -- Bloqueio do produto base
        END IF;

        IF v_current_price IS NULL THEN
            RAISE EXCEPTION 'Produto ou variante não encontrado: %', v_product_id;
        END IF;

        v_subtotal := v_subtotal + (v_current_price * v_quantity);
    END LOOP;

    -- D. Cálculo SEGURO de Frete
    IF v_subtotal >= COALESCE(v_store_config.free_shipping_min, 99999) THEN
        v_shipping_calc := 0;
    ELSE
        v_shipping_calc := COALESCE(v_store_config.shipping_fee, 0);
    END IF;

    -- E. Validar Cupom (Server-side)
    IF p_coupon_code IS NOT NULL AND p_coupon_code <> '' THEN
        SELECT val.is_valid, val.discount_amount, val.error_message 
        INTO v_coupon_valid, v_coupon_discount, v_coupon_error
        FROM public.validate_coupon_secure(p_coupon_code, v_subtotal) val;
        
        IF v_coupon_valid THEN
            v_discount := v_coupon_discount;
            -- Increment usage
            UPDATE public.coupons SET usage_count = usage_count + 1 WHERE UPPER(code) = UPPER(p_coupon_code);
        ELSE
            -- Opcional: Ignorar cupom inválido ou retornar erro. Vamos retornar erro para ser estrito.
            RETURN jsonb_build_object('success', false, 'error', 'Cupom inválido: ' || v_coupon_error);
        END IF;
    END IF;

    -- F. Valor Total Final
    v_total_amount := GREATEST(0, v_subtotal + v_shipping_calc - v_discount);

    -- G. Criar Cabeçalho do Pedido
    INSERT INTO public.marketplace_orders (
        user_id, total, subtotal, shipping, discount, 
        payment_method, address_id, status, customer_name, customer_phone, notes
    ) VALUES (
        v_user_id, v_total_amount, v_subtotal, v_shipping_calc, v_discount,
        p_payment_method, p_address_id, 'pending', p_customer_name, p_customer_phone, p_notes
    ) RETURNING id INTO v_order_id;

    -- H. Inserir Itens e Baixar Estoque
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_variant_id := (v_item->>'variant_id')::UUID;
        v_quantity := (v_item->>'quantity')::INTEGER;

        IF v_variant_id IS NOT NULL THEN
            SELECT 
                p.nome, p.imagem_url,
                COALESCE(v.price_override, p.preco_venda)
            INTO v_product_name, v_image_url, v_current_price
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id;

            UPDATE public.product_variants 
            SET stock_increment = stock_increment - v_quantity 
            WHERE id = v_variant_id;
        ELSE
            SELECT nome, imagem_url, preco_venda
            INTO v_product_name, v_image_url, v_current_price
            FROM public.produtos
            WHERE id = v_product_id;

            UPDATE public.produtos 
            SET estoque = estoque - v_quantity 
            WHERE id = v_product_id;
        END IF;

        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, product_name, quantity, price, image_url
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_product_name, v_quantity, v_current_price, v_image_url
        );
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'total', v_total_amount
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$function$
