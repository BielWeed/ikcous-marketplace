-- =============================================================================
-- Frete por transportadora validado no servidor (create_marketplace_order_v23)
-- =============================================================================
--
-- PROBLEMA
--   Toda a configuração de frete por CEP existe (provider, token, faixa local,
--   edge function calculate-shipping), mas o cliente nunca conseguiu usar: a RPC
--   recebia `p_shipping_cost` e simplesmente IGNORAVA, recalculando sempre com
--   `store_config.shipping_fee`. Se o cliente escolhesse "PAC R$ 27,40", o front
--   mandava um total com 27,40 e o banco calculava com a taxa padrão — o guard de
--   divergência derrubava o pedido. Por isso a calculadora nunca foi montada na tela.
--
-- POR QUE UMA FUNÇÃO NOVA, E NÃO PARÂMETROS NOVOS NA v22
--   Acrescentar parâmetros com DEFAULT à v22 criaria uma sobrecarga: uma chamada
--   com 10 argumentos passaria a casar com as duas versões e o Postgres recusaria
--   por ambiguidade — quebrando o checkout. Com um nome novo isso não acontece, e
--   a v22 continua existindo como fachada, delegando para a v23. Assim o banco pode
--   ser atualizado antes do front sem nenhuma janela de erro.
--
-- COMO A VALIDAÇÃO FUNCIONA
--   O preço do frete NÃO vem do cliente. O cliente informa apenas qual opção
--   escolheu (`p_shipping_option_id`) e para qual CEP (`p_destination_cep`); o
--   banco vai buscar o VALOR na cotação que o próprio servidor gravou em
--   shipping_quotes_cache quando a edge function rodou. Manipular o preço no
--   navegador não tem efeito: o número usado é sempre o do servidor.
--
--   A cotação vale por 24h. Expirada ou inexistente, o pedido é recusado com uma
--   mensagem que orienta a recalcular — em vez do erro genérico de divergência.
--
-- PRECEDÊNCIA (a mesma do frontend)
--   1. algum item com frete grátis próprio      -> 0
--   2. logado e acima do mínimo da loja         -> 0
--   3. opção de transportadora escolhida        -> preço gravado na cotação
--   4. nada disso                               -> store_config.shipping_fee
-- =============================================================================

-- =============================================================================
-- Espelho SQL do isLocalCep da edge function.
-- Necessário porque a opção "Entrega Local" costuma ser mais barata que a taxa
-- padrão: sem conferir o CEP, qualquer cliente poderia reivindicá-la de qualquer
-- lugar do país. O hífen faz parte do CEP ("38500-000") e NÃO é separador de faixa.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_local_cep(
    p_origin_cep TEXT,
    p_dest_cep TEXT,
    p_local_cep_range TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
    v_origem text := regexp_replace(COALESCE(p_origin_cep, ''), '\D', '', 'g');
    v_destino text := regexp_replace(COALESCE(p_dest_cep, ''), '\D', '', 'g');
    v_destino_num numeric;
    v_token text;
    v_partes text[];
    v_simples text[] := ARRAY[]::text[];
    v_achou_faixa boolean := false;
    v_tem_faixa boolean := false;
    v_inicio numeric;
    v_fim numeric;
    v_a numeric;
    v_b numeric;
BEGIN
    IF v_origem = '' OR v_destino = '' THEN RETURN false; END IF;

    -- Sem faixa configurada: mesma regra da edge function, 5 primeiros dígitos.
    IF p_local_cep_range IS NULL OR btrim(p_local_cep_range) = '' THEN
        RETURN left(v_origem, 5) = left(v_destino, 5);
    END IF;

    v_destino_num := rpad(v_destino, 8, '0')::numeric;

    FOREACH v_token IN ARRAY string_to_array(p_local_cep_range, ',')
    LOOP
        SELECT array_agg(d) INTO v_partes
        FROM (
            SELECT regexp_replace(x, '\D', '', 'g') AS d
            FROM unnest(string_to_array(v_token, '-')) AS x
        ) s
        WHERE s.d <> '';

        IF v_partes IS NULL THEN CONTINUE; END IF;

        -- "38500000-38505000": dois blocos longos = faixa explícita.
        IF array_length(v_partes, 1) = 2
           AND length(v_partes[1]) >= 6 AND length(v_partes[2]) >= 6 THEN
            v_tem_faixa := true;
            v_a := rpad(v_partes[1], 8, '0')::numeric;
            v_b := rpad(v_partes[2], 8, '9')::numeric;
            v_inicio := LEAST(v_a, v_b);
            v_fim := GREATEST(v_a, v_b);
            IF v_destino_num BETWEEN v_inicio AND v_fim THEN
                v_achou_faixa := true;
            END IF;
        ELSE
            v_simples := array_append(v_simples, array_to_string(v_partes, ''));
        END IF;
    END LOOP;

    IF v_achou_faixa THEN RETURN true; END IF;

    -- Formato do placeholder do admin ("38500-000, 38500-999"): dois CEPs completos.
    IF NOT v_tem_faixa AND array_length(v_simples, 1) = 2
       AND length(v_simples[1]) = 8 AND length(v_simples[2]) = 8 THEN
        v_a := v_simples[1]::numeric;
        v_b := v_simples[2]::numeric;
        RETURN v_destino_num BETWEEN LEAST(v_a, v_b) AND GREATEST(v_a, v_b);
    END IF;

    -- Demais casos: CEP completo casa exato, item curto vale como prefixo.
    IF v_simples IS NOT NULL THEN
        FOREACH v_token IN ARRAY v_simples
        LOOP
            IF length(v_token) = 8 THEN
                IF v_destino = v_token THEN RETURN true; END IF;
            ELSIF v_destino LIKE v_token || '%' THEN
                RETURN true;
            END IF;
        END LOOP;
    END IF;

    RETURN false;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.is_local_cep(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_marketplace_order_v23(
    p_items JSONB,
    p_total_amount NUMERIC,
    p_shipping_cost NUMERIC,
    p_payment_method TEXT,
    p_address_id UUID,
    p_coupon_code TEXT,
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_observation TEXT,
    p_address_data JSONB,
    p_destination_cep TEXT,
    p_shipping_option_id TEXT
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
    v_dest_cep text;

    v_coupon_type text;
    v_coupon_val numeric;
BEGIN
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

    -- 4. Shipping Calculation
    v_free_shipping_min := COALESCE(NULLIF(v_store_config.free_shipping_min, 0), 999999);

    IF v_has_free_shipping_item = true
       OR (v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min)
    THEN
        v_shipping_validated := 0;

    ELSIF p_shipping_option_id IS NULL OR p_shipping_option_id = '' THEN
        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);

    -- ATENÇÃO: a edge function RETORNA ANTES de gravar no cache quando o provider
    -- é 'flat_fee' ou quando a entrega é local. Essas opções nunca aparecem em
    -- shipping_quotes_cache, então precisam ser resolvidas direto pela config —
    -- que é valor de servidor de qualquer forma, sem risco de manipulação.
    ELSIF p_shipping_option_id LIKE 'flat-fee-%' THEN
        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);

    ELSIF p_shipping_option_id = 'local-delivery' THEN
        v_dest_cep := regexp_replace(COALESCE(p_destination_cep, ''), '\D', '', 'g');
        IF public.is_local_cep(v_store_config.origin_cep, v_dest_cep, v_store_config.local_cep_range) THEN
            v_shipping_validated := COALESCE(v_store_config.local_delivery_fee, 0);
        ELSE
            RAISE EXCEPTION 'Entrega local não disponível para o CEP informado.'
                USING DETAIL = format('CEP %s fora da faixa local configurada.', v_dest_cep);
        END IF;

    ELSIF p_destination_cep IS NOT NULL THEN
        v_dest_cep := regexp_replace(p_destination_cep, '\D', '', 'g');

        -- Cotação de transportadora: o preço sai do que o SERVIDOR gravou,
        -- nunca do que o cliente enviou.
        SELECT (opt->>'price')::numeric
          INTO v_shipping_validated
          FROM public.shipping_quotes_cache q,
               LATERAL jsonb_array_elements(q.options) AS opt
         WHERE regexp_replace(q.destination_cep, '\D', '', 'g') = v_dest_cep
           AND regexp_replace(COALESCE(q.origin_cep, ''), '\D', '', 'g')
               = regexp_replace(COALESCE(v_store_config.origin_cep, ''), '\D', '', 'g')
           AND q.created_at > now() - interval '24 hours'
           AND opt->>'id' = p_shipping_option_id
         ORDER BY q.created_at DESC
         LIMIT 1;

        IF v_shipping_validated IS NULL THEN
            RAISE EXCEPTION 'A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.'
                USING DETAIL = format(
                    'Sem cotação válida nas últimas 24h para cep=%s, opção=%s.',
                    v_dest_cep, p_shipping_option_id
                );
        END IF;

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

        IF v_discount_amount > v_calculated_subtotal THEN
            v_discount_amount := v_calculated_subtotal;
        END IF;
    END IF;

    v_calculated_total := GREATEST(0, v_calculated_subtotal + v_shipping_validated - v_discount_amount);

    -- 6. Price Tampering Protection
    IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN
        RAISE EXCEPTION 'Os valores do pedido mudaram. Atualize o carrinho e tente novamente.'
            USING DETAIL = format(
                'Divergência de total. Calculado: %s (subtotal %s + frete %s - desconto %s), Fornecido: %s. Autenticado: %s. Opção de frete: %s.',
                v_calculated_total, v_calculated_subtotal, v_shipping_validated,
                v_discount_amount, p_total_amount, (v_user_id IS NOT NULL),
                COALESCE(p_shipping_option_id, 'padrão')
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
        jsonb_build_object(
            'whatsapp', p_customer_phone,
            'address_id', p_address_id,
            'address', p_address_data,
            'shipping_option_id', p_shipping_option_id,
            'destination_cep', v_dest_cep
        ),
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

-- =============================================================================
-- v22 vira fachada: delega para a v23 sem opção de frete.
-- Mantém funcionando qualquer cliente ainda não atualizado.
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
BEGIN
    RETURN public.create_marketplace_order_v23(
        p_items, p_total_amount, p_shipping_cost, p_payment_method,
        p_address_id, p_coupon_code, p_customer_name, p_customer_phone,
        p_observation, p_address_data, NULL, NULL
    );
END;
$function$;

-- Índice para a busca de cotação ficar barata mesmo com a tabela crescendo.
CREATE INDEX IF NOT EXISTS idx_shipping_quotes_cache_recentes
    ON public.shipping_quotes_cache (destination_cep, created_at DESC);

GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v23(
    JSONB, NUMERIC, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v22(
    JSONB, NUMERIC, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, JSONB
) TO anon, authenticated, service_role;
