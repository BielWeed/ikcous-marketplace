-- BASELINE DO SCHEMA VIVO — 20260806000000
--
-- Gerado em 06/08/2026 a partir do banco de producao cafkrminfnokvgjqtkle,
-- pela decisao registrada em docs/decisoes/0002-baseline-do-ledger-de-migrations.md
-- (BANCO-050 #42, BANCO-030 #112).
--
-- ============================================================================
-- NAO EXECUTE ESTE ARQUIVO CONTRA A PRODUCAO.
-- ============================================================================
--
-- Ele DESCREVE o schema que ja existe; nao e um passo a aplicar. No ledger ele
-- entra marcado como aplicado, sem rodar. Executa-lo contra o banco vivo tenta
-- recriar 29 tabelas que ja estao la.
--
-- Para que serve: e a resposta ao criterio 5 da #112 — "existe uma forma
-- verificavel de saber, a partir do repositorio, qual e o estado real do
-- banco". Antes dele, nao existia.
--
-- ----------------------------------------------------------------------------
-- COMO ELE FOI GERADO, E POR QUE NAO PELO CAMINHO OBVIO
-- ----------------------------------------------------------------------------
--
-- NAO saiu de `supabase db dump`. Aquele comando OMITE TRIGGERS em silencio:
-- rodado neste mesmo banco no mesmo dia, ele trouxe 0 CREATE TRIGGER enquanto o
-- banco tem 9 — incluindo tr_prevent_role_change, tr_ensure_role_protection e
-- tr_sync_profile_role_to_auth, que sao protecao de privilegio. Um baseline
-- vindo dali derrubaria as tres sem avisar.
--
-- Saiu de pg_dump direto, dentro do container do Postgres:
--
--   docker run --rm -e PGURL public.ecr.aws/supabase/postgres:17.6.1.143 \
--     pg_dump --schema-only --schema=public --no-owner --no-privileges "$PGURL"
--
-- ----------------------------------------------------------------------------
-- O QUE ELE CONTEM (conferido contra introspecao independente do mesmo dia)
-- ----------------------------------------------------------------------------
--
--   CREATE TABLE ....... 29      (29 tabelas medidas no banco)
--   CREATE VIEW ........ 5       (5 views medidas)
--   CREATE TRIGGER ..... 9       (9 triggers medidos)
--   CREATE POLICY ...... 71      (71 policies medidas)
--   CREATE FUNCTION .... 66      (66 funcoes medidas)
--   CREATE INDEX ....... 35      (35 indices medidos)
--
-- Os seis numeros batem com o que scripts/db-snapshot-politicas.cjs e a
-- introspecao de catalogo mediram por caminho separado. Nao e "o dump rodou";
-- e "o dump rodou e o resultado confere".
--
-- ----------------------------------------------------------------------------
-- O QUE ELE NAO CONTEM
-- ----------------------------------------------------------------------------
--
--   - DADOS. E --schema-only. Backup de dados e o diario do Supabase (7 dias,
--     sem PITR) — ver docs/onboarding/03-SETUP-AMBIENTE.md secao 9.
--   - GRANTS e OWNERS. Sairam com --no-owner --no-privileges, porque owner de
--     producao nao existe em outro ambiente. Os 288 GRANT vivos estao no
--     snapshot de backups/, gerado por db-snapshot-politicas.cjs.
--   - Os schemas auth, storage e realtime. So public.
--   - O PORQUE das 28 versoes do ledger sem arquivo. Este baseline absorve o
--     EFEITO delas; o motivo esta perdido para sempre.
--
-- ============================================================================

--
-- PostgreSQL database dump
--

\restrict ZEJ03sZ5WLRTbXXkN9Eq1IHGArmg5qA5xBCSHuCVHfKjVNDSrifAn6UtMnM4Ppv

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: answer_question_atomic("uuid", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.answer_question_atomic("p_question_id" "uuid", "p_answer" "text") RETURNS "void"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

    -- 1. Insert Answer
    INSERT INTO answers (question_id, user_id, answer)
    VALUES (p_question_id, v_admin_id, p_answer);

    -- 2. Get Question Info
    SELECT user_id, product_id INTO v_user_id, v_product_id 
    FROM questions WHERE id = p_question_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM produtos WHERE id = v_product_id;

        -- 3. Log Notification
        INSERT INTO push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua pergunta foi respondida!', 
            'A loja respondeu à sua pergunta sobre o produto ' || COALESCE(v_product_name, 'selecionado') || '.', 
            '/product/' || v_product_id, 
            1, 
            v_admin_id
        );
    END IF;
END;
$$;


--
-- Name: answer_question_atomic("uuid", "text", "uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.answer_question_atomic("p_question_id" "uuid", "p_answer" "text", "p_admin_id" "uuid") RETURNS "void"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
BEGIN
    -- SECURITY CHECK: Reject any caller that is not an admin
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can answer questions.';
    END IF;

    -- 1. Insert Answer
    INSERT INTO public.answers (question_id, user_id, answer)
    VALUES (p_question_id, p_admin_id, p_answer);

    -- 2. Get Question Info
    SELECT user_id, product_id INTO v_user_id, v_product_id 
    FROM public.questions WHERE id = p_question_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM public.produtos WHERE id = v_product_id;

        -- 3. Log Notification
        INSERT INTO public.push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua pergunta foi respondida!', 
            'A loja respondeu a sua pergunta sobre o produto ' || COALESCE(v_product_name, 'selecionado') || '.', 
            '/product/' || v_product_id, 
            1, 
            p_admin_id
        );
    END IF;
END;
$$;


--
-- Name: check_is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_is_admin() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RETURN public.is_admin();
END;
$$;


--
-- Name: check_stock_v1("uuid", "uuid", integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_stock_v1("p_product_id" "uuid", "p_variant_id" "uuid", "p_quantity" integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_stock INTEGER;
BEGIN
    IF p_variant_id IS NOT NULL THEN
        SELECT stock INTO v_stock FROM product_variants WHERE id = p_variant_id AND product_id = p_product_id;
    ELSE
        SELECT stock INTO v_stock FROM produtos WHERE id = p_product_id;
    END IF;

    RETURN COALESCE(v_stock, 0) >= p_quantity;
END;
$$;


--
-- Name: check_user_confirmation_status("text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_user_confirmation_status("p_email" "text") RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_confirmed boolean;
    v_exists boolean;
BEGIN
    SELECT 
        (email_confirmed_at IS NOT NULL),
        true
    INTO v_confirmed, v_exists
    FROM auth.users
    WHERE email = LOWER(TRIM(p_email))
    LIMIT 1;

    RETURN jsonb_build_object(
        'exists', COALESCE(v_exists, false),
        'confirmed', COALESCE(v_confirmed, false)
    );
END;
$$;


--
-- Name: FUNCTION check_user_confirmation_status("p_email" "text"); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.check_user_confirmation_status("p_email" "text") IS 'Verifica se um e-mail existe na base de auth do Supabase e se já foi confirmado.';


--
-- Name: clean_expired_shipping_quotes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clean_expired_shipping_quotes() RETURNS "trigger"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    DELETE FROM public.shipping_quotes_cache
    WHERE created_at < NOW() - INTERVAL '24 hours';
    RETURN NEW;
END;
$$;


--
-- Name: clean_old_shipping_logs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clean_old_shipping_logs() RETURNS "trigger"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    DELETE FROM public.shipping_calculation_logs
    WHERE created_at < NOW() - INTERVAL '30 days';
    RETURN NEW;
END;
$$;


--
-- Name: create_marketplace_order("jsonb", "text", "uuid", "text", "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_marketplace_order("p_items" "jsonb", "p_payment_method" "text", "p_address_id" "uuid", "p_coupon_code" "text" DEFAULT NULL::"text", "p_customer_name" "text" DEFAULT NULL::"text", "p_customer_phone" "text" DEFAULT NULL::"text", "p_observation" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_order_id uuid;
    v_item jsonb;
    v_product_id uuid;
    v_variant_id uuid;
    v_quantity integer;
    v_db_price numeric;
    v_db_stock integer;
    v_calculated_subtotal numeric := 0;
    v_calculated_total numeric := 0;
    v_shipping_validated numeric := 0;
    v_discount_amount numeric := 0;
    v_coupon_id uuid;
    v_store_config RECORD;
    v_product_name text;
    v_image_url text;
BEGIN
    -- [SECURITY] Auth check
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

    -- [SECURITY] Address BOLA check
    IF p_address_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN
            RAISE EXCEPTION 'Endereço inválido ou tentativa de BOLA detectada.';
        END IF;
    END IF;

    -- 1. Load Store Config
    SELECT * INTO v_store_config FROM public.store_config WHERE id = 1;

    -- 2. Validate Items & Calculate Subtotal
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        
        IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;

        IF v_variant_id IS NOT NULL THEN
            SELECT 
                COALESCE(v.price_override, p.preco_venda), v.stock_increment, p.nome, p.imagem_url
            INTO v_db_price, v_db_stock, v_product_name, v_image_url
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id AND p.id = v_product_id
              AND v.active = true AND p.ativo = true
            FOR NO KEY UPDATE OF v;
        ELSE
            SELECT preco_venda, estoque, nome, imagem_url
            INTO v_db_price, v_db_stock, v_product_name, v_image_url
            FROM public.produtos
            WHERE id = v_product_id AND ativo = true
            FOR NO KEY UPDATE;
        END IF;

        IF v_db_price IS NULL THEN RAISE EXCEPTION 'Produto não encontrado ou inativo.'; END IF;
        IF v_db_stock < v_quantity THEN RAISE EXCEPTION 'Estoque insuficiente para: %', v_product_name; END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_db_price * v_quantity);
    END LOOP;

    -- 3. Calculate Shipping
    IF v_calculated_subtotal >= COALESCE(v_store_config.free_shipping_min, 999999) THEN
        v_shipping_validated := 0;
    ELSE
        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);
    END IF;

    -- 4. Validate Coupon
    IF p_coupon_code IS NOT NULL AND p_coupon_code != '' THEN
        SELECT id, value INTO v_coupon_id, v_discount_amount
        FROM public.coupons
        WHERE code = p_coupon_code 
          AND active = true 
          AND (valid_until IS NULL OR valid_until > now())
          AND (usage_limit IS NULL OR usage_count < usage_limit)
          AND (min_purchase IS NULL OR v_calculated_subtotal >= min_purchase)
          FOR SHARE;
          
        IF v_coupon_id IS NULL THEN
            RAISE EXCEPTION 'Cupom inválido ou expirado.';
        END IF;
    END IF;

    -- 5. Final Calculation
    v_calculated_total := GREATEST(0, v_calculated_subtotal + v_shipping_validated - v_discount_amount);

    -- 6. Insert Order
    INSERT INTO public.marketplace_orders (
        user_id, total_amount, shipping_cost, payment_method, address_id, 
        coupon_id, status, observation, customer_name, customer_data,
        subtotal, discount
    ) VALUES (
        v_user_id, v_calculated_total, v_shipping_validated, p_payment_method, p_address_id, 
        v_coupon_id, 'pending', p_observation, p_customer_name,
        jsonb_build_object('whatsapp', p_customer_phone, 'address_id', p_address_id),
        v_calculated_subtotal, v_discount_amount
    ) RETURNING id INTO v_order_id;

    -- 7. Process Items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        
        IF v_variant_id IS NOT NULL THEN
            UPDATE public.product_variants SET stock_increment = stock_increment - v_quantity WHERE id = v_variant_id;
            SELECT COALESCE(v.price_override, p.preco_venda), p.nome INTO v_db_price, v_product_name FROM public.produtos p JOIN public.product_variants v ON v.product_id = p.id WHERE v.id = v_variant_id;
        ELSE
            UPDATE public.produtos SET estoque = estoque - v_quantity WHERE id = v_product_id;
            SELECT preco_venda, nome INTO v_db_price, v_product_name FROM public.produtos WHERE id = v_product_id;
        END IF;

        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, quantity, price, product_name
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price, v_product_name
        );
    END LOOP;

    -- 8. Finalize
    IF v_coupon_id IS NOT NULL THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_id;
    END IF;

    RETURN v_order_id;
END;
$$;


--
-- Name: create_marketplace_order_v22("jsonb", numeric, numeric, "text", "uuid", "text", "text", "text", "text", "jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_marketplace_order_v22("p_items" "jsonb", "p_total_amount" numeric, "p_shipping_cost" numeric, "p_payment_method" "text", "p_address_id" "uuid", "p_coupon_code" "text", "p_customer_name" "text", "p_customer_phone" "text", "p_observation" "text", "p_address_data" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RETURN public.create_marketplace_order_v23(
        p_items, p_total_amount, p_shipping_cost, p_payment_method,
        p_address_id, p_coupon_code, p_customer_name, p_customer_phone,
        p_observation, p_address_data, NULL, NULL
    );
END;
$$;


--
-- Name: create_marketplace_order_v23("jsonb", numeric, numeric, "text", "uuid", "text", "text", "text", "text", "jsonb", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_marketplace_order_v23("p_items" "jsonb", "p_total_amount" numeric, "p_shipping_cost" numeric, "p_payment_method" "text", "p_address_id" "uuid", "p_coupon_code" "text", "p_customer_name" "text", "p_customer_phone" "text", "p_observation" "text", "p_address_data" "jsonb", "p_destination_cep" "text", "p_shipping_option_id" "text") RETURNS "uuid"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: decrement_stock("uuid", integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decrement_stock("p_id" "uuid", "quantity" integer) RETURNS "void"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Segurança: Apenas admins podem decrementar estoque manualmente.
  -- Pedidos devem usar triggers internos ou service_role.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  UPDATE public.produtos
  SET estoque = estoque - quantity
  WHERE id = p_id;
END;
$$;


--
-- Name: ensure_role_protection(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_role_protection() RETURNS "trigger"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF (auth.uid() IS NOT NULL) AND (auth.role() <> 'service_role') AND (OLD.role IS DISTINCT FROM NEW.role) THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
            AND role = 'admin'
        ) THEN
            NEW.role := OLD.role;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: generate_order_otp_v1("text", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_order_otp_v1("p_email" "text", "p_whatsapp" "text", "p_order_fragment" "text") RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
    v_otp TEXT;
    v_order_id uuid;
    v_fragmento TEXT := trim(coalesce(p_order_fragment, ''));
BEGIN
    DELETE FROM public.otp_verifications WHERE expires_at < NOW();

    -- Os dois canais são obrigatórios. Era aqui que o OR deixava o WhatsApp
    -- sozinho abrir o fluxo com o e-mail de quem estivesse pedindo.
    IF coalesce(trim(p_email), '') = '' OR coalesce(trim(p_whatsapp), '') = '' THEN
        RETURN FALSE;
    END IF;

    -- Fragmento com no mínimo 6 caracteres, e só o alfabeto de um UUID. O
    -- comprimento tira o `ILIKE '%'`; a restrição de alfabeto impede que um `%`
    -- ou `_` digitado no campo volte a funcionar como curinga.
    IF v_fragmento !~ '^[0-9a-fA-F-]{6,}$' THEN
        RETURN FALSE;
    END IF;

    -- AND entre os canais, e o pedido tem de ser UM só. Se o sufixo casar com
    -- mais de um, não dá para saber a qual amarrar o código.
    SELECT o.id INTO v_order_id
      FROM public.marketplace_orders o
      LEFT JOIN auth.users u ON u.id = o.user_id
     WHERE regexp_replace(
               coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''),
               '[^0-9]', '', 'g'
           ) = regexp_replace(p_whatsapp, '[^0-9]', '', 'g')
       AND (
             LOWER(coalesce(o.customer_data->>'email', '')) = LOWER(trim(p_email))
          OR LOWER(coalesce(u.email, ''))                   = LOWER(trim(p_email))
       )
       AND o.id::text ILIKE '%' || v_fragmento;

    IF NOT FOUND OR v_order_id IS NULL THEN
        RETURN FALSE;
    END IF;

    v_otp := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');

    INSERT INTO public.otp_verifications (email, whatsapp, otp_code, expires_at, order_id)
    VALUES (trim(p_email), p_whatsapp, v_otp, NOW() + INTERVAL '15 minutes', v_order_id);

    RETURN TRUE;
END;
$_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: produtos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.produtos (
    id "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    nome "text" NOT NULL,
    descricao "text",
    categoria "text",
    codigo "text",
    custo numeric(10,2) NOT NULL,
    preco_venda numeric(10,2) NOT NULL,
    estoque integer DEFAULT 0,
    estoque_minimo integer DEFAULT 5,
    fornecedor_id "uuid",
    ativo boolean DEFAULT true,
    tags "text"[],
    data_cadastro timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    ultima_atualizacao timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    imagem_url "text",
    meta_title "text",
    meta_description "text",
    imagem_urls "text"[] DEFAULT '{}'::"text"[],
    preco_original numeric(10,2),
    is_bestseller boolean DEFAULT false,
    frete_gratis boolean DEFAULT false,
    sold integer DEFAULT 0,
    deleted_at timestamp with time zone,
    calculated_points integer DEFAULT 0,
    rating numeric DEFAULT 5,
    review_count integer DEFAULT 0,
    peso_kg numeric DEFAULT 0.3,
    largura_cm numeric DEFAULT 15,
    altura_cm numeric DEFAULT 15,
    comprimento_cm numeric DEFAULT 15,
    CONSTRAINT check_altura_positive CHECK (("altura_cm" >= (0)::numeric)),
    CONSTRAINT check_comprimento_positive CHECK (("comprimento_cm" >= (0)::numeric)),
    CONSTRAINT check_estoque_positivo CHECK (("estoque" >= 0)),
    CONSTRAINT check_largura_positive CHECK (("largura_cm" >= (0)::numeric)),
    CONSTRAINT check_peso_positive CHECK (("peso_kg" >= (0)::numeric))
);


--
-- Name: COLUMN produtos.rating; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.produtos.rating IS 'Average rating from 1 to 5';


--
-- Name: COLUMN produtos.review_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.produtos.review_count IS 'Total number of reviews';


--
-- Name: COLUMN produtos.peso_kg; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.produtos.peso_kg IS 'Peso do produto em quilogramas (kg) para cálculo de frete.';


--
-- Name: COLUMN produtos.largura_cm; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.produtos.largura_cm IS 'Largura da embalagem do produto em centímetros (cm) para cálculo de frete.';


--
-- Name: COLUMN produtos.altura_cm; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.produtos.altura_cm IS 'Altura da embalagem do produto em centímetros (cm) para cálculo de frete.';


--
-- Name: COLUMN produtos.comprimento_cm; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.produtos.comprimento_cm IS 'Comprimento da embalagem do produto em centímetros (cm) para cálculo de frete.';


--
-- Name: get_active_products_internal(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_products_internal() RETURNS SETOF "public"."produtos"
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    -- Return only non-deleted, active products
    -- The owner (postgres) bypasses RLS
    SELECT * FROM public.produtos 
    WHERE ativo = true 
    AND (deleted_at IS NULL);
$$;


--
-- Name: get_admin_analytics_v2(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_analytics_v2("p_limit_days" integer DEFAULT 90) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    result json;
    active_users_count int;
    low_stock_count int;
    
    -- Today stats
    today_revenue numeric;
    today_count bigint;
    today_pending bigint;
    yesterday_revenue numeric;
    yesterday_count bigint;
    today_rev_trend numeric;
    today_count_trend numeric;
    
    -- month stats (rolling 30 days)
    month_revenue numeric;
    month_count bigint;
    prev_month_revenue numeric;
    prev_month_count bigint;
    month_rev_trend numeric;
    month_count_trend numeric;
    
    -- executive stats (all-time)
    total_rev numeric;
    total_ord bigint;
    
    -- avg ticket (all-time)
    avg_ticket numeric;
    
    -- active customers (all-time)
    active_customers bigint;
    
    -- inventory values
    inv_cost_total numeric;
    inv_value_total numeric;
    
    -- lists
    rev_history json;
    top_prods json;
BEGIN
    -- 0. Security Check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- 1. Today vs Yesterday (Same period)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO today_revenue, today_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now())
    AND status NOT IN ('cancelled', 'returned');

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO yesterday_revenue, yesterday_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now() - interval '1 day')
    AND created_at < now() - interval '1 day'
    AND status NOT IN ('cancelled', 'returned');

    today_rev_trend := CASE WHEN yesterday_revenue > 0 THEN ((today_revenue - yesterday_revenue) / yesterday_revenue) * 100 ELSE (CASE WHEN today_revenue > 0 THEN 100 ELSE 0 END) END;
    today_count_trend := CASE WHEN yesterday_count > 0 THEN ((today_count::numeric - yesterday_count::numeric) / yesterday_count::numeric) * 100 ELSE (CASE WHEN today_count > 0 THEN 100 ELSE 0 END) END;

    SELECT COUNT(*) INTO today_pending
    FROM public.marketplace_orders
    WHERE status in ('pending', 'new', 'processing');

    -- 2. month vs Previous Month (Rolling 30 Days)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO month_revenue, month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned');

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO prev_month_revenue, prev_month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '60 days'
    AND created_at < now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned');

    month_rev_trend := CASE WHEN prev_month_revenue > 0 THEN ((month_revenue - prev_month_revenue) / prev_month_revenue) * 100 ELSE (CASE WHEN month_revenue > 0 THEN 100 ELSE 0 END) END;
    month_count_trend := CASE WHEN prev_month_count > 0 THEN ((month_count::numeric - prev_month_count::numeric) / prev_month_count::numeric) * 100 ELSE (CASE WHEN month_count > 0 THEN 100 ELSE 0 END) END;

    -- 3. Executive Metrics (All-time total metrics)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO total_rev, total_ord
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned');

    avg_ticket := CASE WHEN total_ord > 0 THEN total_rev / total_ord ELSE 0 END;

    SELECT COUNT(DISTINCT COALESCE(user_id::text, customer_data->>'email', customer_data->>'whatsapp'))
    INTO active_customers
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned');

    SELECT COUNT(*) INTO active_users_count FROM public.profiles;

    SELECT COUNT(*) INTO low_stock_count 
    FROM public.produtos 
    WHERE estoque <= COALESCE(estoque_minimo, 5) AND ativo = true AND deleted_at IS NULL;

    -- Compute current total inventory cost and value
    SELECT 
        COALESCE(SUM(custo * estoque), 0),
        COALESCE(SUM(preco_venda * estoque), 0)
    INTO inv_cost_total, inv_value_total
    FROM public.produtos
    WHERE deleted_at IS NULL AND ativo = true;

    -- 4. Revenue, Orders, Profit & Cost History (Filtered by p_limit_days for performance)
    -- This scans only within the required range using the created_at index or created_at::date expression index
    SELECT json_agg(h)
    INTO rev_history
    FROM (
        WITH days AS (
            SELECT generate_series(
                (now() - (p_limit_days || ' days')::interval)::date,
                now()::date,
                interval '1 day'
            )::date AS day
        ),
        daily_orders AS (
            SELECT 
                (o.created_at AT TIME ZONE 'UTC')::date AS day,
                COALESCE(SUM(o.total), 0) AS revenue,
                COUNT(o.id)::int as orders
            FROM public.marketplace_orders o
            WHERE o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
              AND o.status NOT IN ('cancelled', 'returned')
            GROUP BY ((o.created_at AT TIME ZONE 'UTC')::date)
        ),
        daily_items AS (
            SELECT 
                (o.created_at AT TIME ZONE 'UTC')::date AS day,
                COALESCE(SUM(oi.quantity * (oi.price - COALESCE(p.custo, 0))), 0) AS profit,
                COALESCE(SUM(oi.quantity * COALESCE(p.custo, 0)), 0) AS cost_sold
            FROM public.marketplace_order_items oi
            JOIN public.marketplace_orders o ON oi.order_id = o.id
            LEFT JOIN public.produtos p ON oi.product_id = p.id
            WHERE o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
              AND o.status NOT IN ('cancelled', 'returned')
            GROUP BY ((o.created_at AT TIME ZONE 'UTC')::date)
        )
        SELECT 
            TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
            TO_CHAR(d.day, 'DD/MM') AS full_date,
            COALESCE(dor.revenue, 0) AS revenue,
            COALESCE(dor.orders, 0) AS orders,
            COALESCE(dit.profit, 0) AS profit,
            COALESCE(dit.cost_sold, 0) AS cost_sold
        FROM days d
        LEFT JOIN daily_orders dor ON d.day = dor.day
        LEFT JOIN daily_items dit ON d.day = dit.day
        ORDER BY d.day ASC
    ) h;

    -- 5. Top Products (All time)
    SELECT json_agg(p)
    INTO top_prods
    FROM (
        SELECT 
            p.id as id,
            p.nome AS name,
            SUM(oi.quantity)::int as quantity,
            SUM(oi.quantity * oi.price) as total,
            COALESCE(p.imagem_url, '') as image
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        WHERE o.status NOT IN ('cancelled', 'returned')
        AND p.deleted_at IS NULL
        GROUP BY p.id, p.nome, p.imagem_url
        ORDER BY total DESC
        LIMIT 5
    ) p;

    -- BUILD FINAL OBJECT (Matching DashboardStats interface 100%)
    result := json_build_object(
        'today', json_build_object(
            'revenue', today_revenue, 
            'count', today_count, 
            'pending', today_pending,
            'revenueTrend', round(today_rev_trend, 1),
            'countTrend', round(today_count_trend, 1)
        ),
        'month', json_build_object(
            'revenue', month_revenue, 
            'count', month_count,
            'revenueTrend', round(month_rev_trend, 1),
            'countTrend', round(month_count_trend, 1)
        ),
        'executive', json_build_object(
            'totalRevenue', total_rev,
            'totalOrders', total_ord,
            'revenueTrend', 0,
            'ordersTrend', 0,
            'avgTicket', round(avg_ticket, 2),
            'avgTicketTrend', 0,
            'activeCustomers', active_customers,
            'activeCustomersTrend', 0
        ),
        'revenueHistory', COALESCE(rev_history, '[]'::json),
        'topProducts', COALESCE(top_prods, '[]'::json),
        'inventoryAlerts', low_stock_count,
        'growth', round(month_rev_trend, 1),
        'inventory', json_build_object(
            'totalCost', inv_cost_total,
            'totalValue', inv_value_total
        ),
        'averageTicket', round(avg_ticket, 2)
    );

    RETURN result;
END;
$$;


--
-- Name: get_admin_customers_paged("text", "text", "text", integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_customers_paged("p_search" "text" DEFAULT ''::"text", "p_sort_field" "text" DEFAULT 'created_at'::"text", "p_sort_direction" "text" DEFAULT 'desc'::"text", "p_page" integer DEFAULT 0, "p_page_size" integer DEFAULT 10) RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    
    -- Global stats variables
    v_global_total_customers BIGINT;
    v_global_new_customers_30d BIGINT;
    v_global_ltv NUMERIC;
    v_global_orders BIGINT;
    v_stats JSONB;
    v_clean_search TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

    -- Calculate global stats (not filtered by search for global dashboard consistency)
    SELECT COUNT(id) INTO v_global_total_customers 
    FROM public.profiles;

    SELECT COUNT(id) INTO v_global_new_customers_30d 
    FROM public.profiles 
    WHERE created_at >= NOW() - INTERVAL '30 days';

    SELECT COUNT(id) INTO v_global_orders 
    FROM public.marketplace_orders 
    WHERE status NOT IN ('cancelled', 'returned');

    SELECT COALESCE(SUM(total::numeric), 0) INTO v_global_ltv 
    FROM public.marketplace_orders 
    WHERE status NOT IN ('cancelled', 'returned');

    v_stats := JSONB_BUILD_OBJECT(
        'total_customers', v_global_total_customers,
        'new_customers_30d', v_global_new_customers_30d,
        'global_ltv', v_global_ltv,
        'global_orders', v_global_orders
    );

    -- CTE to gather aggregated stats per customer with unaccent filtering and pagination count
    WITH customer_stats AS (
        SELECT 
            p.id,
            u.email, 
            p.full_name,
            COALESCE(p.whatsapp, u.phone) as phone, 
            p.role,
            p.created_at,
            p.avatar_url,
            addr.city,
            addr.state,
            EXISTS (
                SELECT 1 
                FROM public.push_subscriptions 
                WHERE user_id = p.id
            ) as is_push_subscribed,
            COUNT(o.id) as orders_count,
            COALESCE(SUM(o.total::numeric), 0) as total_spent,
            MAX(o.created_at) as last_order_date
        FROM public.profiles p
        LEFT JOIN auth.users u ON u.id = p.id
        LEFT JOIN public.user_addresses addr ON addr.user_id = p.id AND addr.is_default = true
        LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')
        WHERE (
            v_clean_search = '' OR (
                unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR 
                unaccent(u.email) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(u.phone) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(p.whatsapp) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(addr.city) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(addr.state) ILIKE unaccent('%' || v_clean_search || '%')
            )
        )
        GROUP BY p.id, u.email, u.phone, p.whatsapp, addr.city, addr.state
    ),
    sorted_data AS (
        SELECT *, COUNT(*) OVER() as full_count FROM customer_stats
        ORDER BY 
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE 
                    WHEN p_sort_field = 'full_name' THEN full_name
                    WHEN p_sort_field = 'email' THEN email
                    WHEN p_sort_field = 'role' THEN role
                    WHEN p_sort_field = 'city' THEN city
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE 
                    WHEN p_sort_field = 'full_name' THEN full_name
                    WHEN p_sort_field = 'email' THEN email
                    WHEN p_sort_field = 'role' THEN role
                    WHEN p_sort_field = 'city' THEN city
                    ELSE NULL
                END
            END DESC,
            -- Numeric ordering
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE 
                    WHEN p_sort_field = 'total_spent' THEN total_spent
                    WHEN p_sort_field = 'orders_count' THEN orders_count::NUMERIC
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE 
                    WHEN p_sort_field = 'total_spent' THEN total_spent
                    WHEN p_sort_field = 'orders_count' THEN orders_count::NUMERIC
                    ELSE NULL
                END
            END DESC,
            -- Temporal ordering
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE 
                    WHEN p_sort_field = 'created_at' THEN created_at
                    WHEN p_sort_field = 'last_order_date' THEN last_order_date
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE 
                    WHEN p_sort_field = 'created_at' THEN created_at
                    WHEN p_sort_field = 'last_order_date' THEN last_order_date
                    ELSE NULL
                END
            END DESC
    ),
    paginated_data AS (
        SELECT * 
        FROM sorted_data
        LIMIT p_page_size
        OFFSET v_offset
    )
    SELECT 
        COALESCE((SELECT full_count FROM sorted_data LIMIT 1), 0),
        COALESCE(jsonb_agg(pd), '[]'::JSONB)
    INTO v_total_count, v_data
    FROM paginated_data pd;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'stats', v_stats
    );
END;
$$;


--
-- Name: get_admin_dashboard_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_dashboard_stats() RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_today_start TIMESTAMP := CURRENT_DATE;
    v_month_start TIMESTAMP := date_trunc('month', CURRENT_DATE);
    v_stats JSONB;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    SELECT jsonb_build_object(
        'today', (
            SELECT jsonb_build_object(
                'count', COUNT(*),
                'revenue', COALESCE(SUM(total), 0),
                'pending', (SELECT COUNT(*) FROM public.marketplace_orders WHERE status IN ('new', 'processing'))
            )
            FROM public.marketplace_orders
            WHERE created_at >= v_today_start
            AND status NOT IN ('cancelled', 'returned')
        ),
        'month', (
            SELECT jsonb_build_object(
                'count', COUNT(*),
                'revenue', COALESCE(SUM(total), 0)
            )
            FROM public.marketplace_orders
            WHERE created_at >= v_month_start
            AND status NOT IN ('cancelled', 'returned')
        ),
        'average_ticket', (
            SELECT COALESCE(AVG(total), 0) 
            FROM public.marketplace_orders 
            WHERE status NOT IN ('cancelled', 'returned')
        ),
        'revenue_history', (
            SELECT jsonb_agg(d.day_data) FROM (
                SELECT jsonb_build_object(
                    'date', to_char(gs.day, 'DD/MM'),
                    'revenue', COALESCE(SUM(o.total), 0)
                ) as day_data
                FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS gs(day)
                LEFT JOIN public.marketplace_orders o ON date_trunc('day', o.created_at) = gs.day 
                    AND o.status NOT IN ('cancelled', 'returned')
                GROUP BY gs.day
                ORDER BY gs.day ASC
            ) d
        )
    ) INTO v_stats;

    RETURN v_stats;
END;
$$;


--
-- Name: get_admin_dashboard_summary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_dashboard_summary() RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    result jsonb;
    today_revenue numeric;
    today_count bigint;
    pending_count bigint;
    month_revenue numeric;
    month_count bigint;
    avg_ticket numeric;
    rev_history jsonb;
    top_prods jsonb;
BEGIN
    -- SECURITY CHECK
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can view the dashboard summary.';
    END IF;

    -- Today stats (Confirmed only)
    SELECT 
        coalesce(sum(total), 0), 
        count(*)
    INTO today_revenue, today_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now())
    AND status NOT IN ('cancelled', 'returned');

    -- Pending count (Unaltered, specifically for tasks)
    SELECT count(*)
    INTO pending_count
    FROM public.marketplace_orders
    WHERE status in ('new', 'processing');

    -- Month stats (Confirmed only)
    SELECT 
        coalesce(sum(total), 0), 
        count(*)
    INTO month_revenue, month_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('month', now())
    AND status NOT IN ('cancelled', 'returned');

    -- Global stats (All time avg ticket - Confirmed only)
    SELECT coalesce(avg(total), 0)
    INTO avg_ticket
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned');

    -- Revenue history (Last 7 days - Confirmed only)
    WITH days AS (
        SELECT generate_series(
            date_trunc('day', now()) - interval '6 days',
            date_trunc('day', now()),
            interval '1 day'
        )::date AS day
    )
    SELECT jsonb_agg(h)
    INTO rev_history
    FROM (
        SELECT 
            to_char(d.day, 'DD/MM') AS date,
            d.day::text AS full_date,
            coalesce(sum(o.total), 0) AS revenue,
            count(o.id) as orders
        FROM days d
        LEFT JOIN public.marketplace_orders o ON date_trunc('day', o.created_at)::date = d.day 
            AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY d.day
        ORDER BY d.day
    ) h;

    -- Top products (Confirmed only)
    SELECT jsonb_agg(p)
    INTO top_prods
    FROM (
        SELECT 
            p.id as product_id,
            p.nome AS name,
            count(o.id) as quantity,
            sum(oi.price * oi.quantity) as total,
            max(p.imagem_url) as image
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        WHERE o.status NOT IN ('cancelled', 'returned')
        GROUP BY p.id, p.nome
        ORDER BY quantity DESC
        LIMIT 5
    ) p;

    result := jsonb_build_object(
        'today', jsonb_build_object('revenue', today_revenue, 'count', today_count, 'pending', pending_count),
        'month', jsonb_build_object('revenue', month_revenue, 'count', month_count),
        'averageTicket', avg_ticket,
        'revenueHistory', rev_history,
        'topProducts', top_prods
    );

    RETURN result;
END;
$$;


--
-- Name: get_admin_executive_summary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_executive_summary() RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_today_revenue NUMERIC;
    v_today_count INT;
    v_today_pending INT;
    v_month_revenue NUMERIC;
    v_month_count INT;
    v_avg_ticket NUMERIC;
    v_revenue_history JSONB;
    v_top_products JSONB;
    v_inventory_health JSONB;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    -- Today stats (Confirmed)
    SELECT 
        COALESCE(SUM(total), 0),
        COUNT(*),
        COALESCE(SUM(CASE WHEN status IN ('new', 'processing') THEN 1 ELSE 0 END), 0)
    INTO v_today_revenue, v_today_count, v_today_pending
    FROM public.marketplace_orders
    WHERE created_at >= CURRENT_DATE
    AND status NOT IN ('cancelled', 'returned');

    -- Month stats (Confirmed)
    SELECT 
        COALESCE(SUM(total), 0),
        COUNT(*)
    INTO v_month_revenue, v_month_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('month', CURRENT_DATE)
    AND status NOT IN ('cancelled', 'returned');

    -- Avg Ticket
    v_avg_ticket := CASE WHEN v_month_count > 0 THEN v_month_revenue / v_month_count ELSE 0 END;

    -- Revenue History (Last 7 days - Confirmed)
    SELECT jsonb_agg(h) INTO v_revenue_history
    FROM (
        SELECT 
            TO_CHAR(d, 'DD/MM') as date,
            COALESCE(SUM(o.total), 0) as revenue
        FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') d
        LEFT JOIN public.marketplace_orders o ON DATE(o.created_at) = DATE(d) 
            AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY d
        ORDER BY d
    ) h;

    -- Top Products (Confirmed)
    SELECT jsonb_agg(p) INTO v_top_products
    FROM (
        SELECT p.nome as name, SUM(oi.quantity) as sold, MAX(oi.price) as price, MAX(p.imagem_url) as image
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        WHERE o.status NOT IN ('cancelled', 'returned')
        GROUP BY p.id, p.nome
        ORDER BY sold DESC
        LIMIT 5
    ) p;

    -- Inventory Health
    SELECT jsonb_agg(i) INTO v_inventory_health
    FROM (
        WITH product_sales AS (
            SELECT oi.product_id, SUM(oi.quantity) as total_qty
            FROM public.marketplace_order_items oi
            JOIN public.marketplace_orders o ON o.id = oi.order_id
            WHERE o.created_at >= NOW() - INTERVAL '30 days' AND o.status NOT IN ('cancelled', 'returned')
            GROUP BY oi.product_id
        )
        SELECT p.nome as product_name, p.estoque as current_stock,
            CASE WHEN ps.total_qty > 0 THEN (p.estoque::FLOAT / (ps.total_qty::FLOAT / 30.0)) ELSE 999 END as days_remaining
        FROM public.produtos p LEFT JOIN product_sales ps ON ps.product_id = p.id
        WHERE p.active = true AND p.estoque <= 5 ORDER BY days_remaining ASC LIMIT 5
    ) i;

    RETURN jsonb_build_object(
        'today', json_build_object('revenue', v_today_revenue, 'count', v_today_count, 'pending', v_today_pending),
        'month', json_build_object('revenue', v_month_revenue, 'count', v_month_count),
        'averageTicket', v_avg_ticket,
        'revenueHistory', v_revenue_history,
        'topProducts', v_top_products,
        'inventoryHealth', v_inventory_health
    );
END;
$$;


--
-- Name: get_admin_list_paginated("text", integer, integer, "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_list_paginated("p_table_name" "text", "p_page_size" integer DEFAULT 20, "p_page_number" integer DEFAULT 0, "p_search_query" "text" DEFAULT NULL::"text", "p_filter_status" "text" DEFAULT 'all'::"text") RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_query text;
    v_total_count bigint;
    v_items jsonb;
BEGIN
    -- SECURITY CHECK: Admin-scoped fetching function guarantees privacy
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can use paginated fetchers.';
    END IF;

    -- This handles specific tables with custom search logic
    IF p_table_name = 'reviews' THEN
        v_query := 'SELECT count(*) FROM public.reviews r JOIN public.produtos p ON r.product_id = p.id JOIN public.profiles pr ON r.user_id = pr.id';
        IF p_search_query IS NOT NULL THEN
            v_query := v_query || ' WHERE (p.nome ILIKE %L OR pr.full_name ILIKE %L OR r.comment ILIKE %L)';
        END IF;
        -- Pagination and aggregation would go here...
    END IF;

    -- For Phase 7, we'll start with standard Supabase pagination in hooks, 
    -- but we ensure indexes exist for the columns used in order/filter.
    RETURN jsonb_build_object('status', 'optimized');
END;
$$;


--
-- Name: get_admin_orders_paged("text", "text", "text", "text", integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_orders_paged("p_search" "text" DEFAULT ''::"text", "p_status" "text" DEFAULT 'all'::"text", "p_start_date" "text" DEFAULT ''::"text", "p_end_date" "text" DEFAULT ''::"text", "p_page" integer DEFAULT 0, "p_page_size" integer DEFAULT 10) RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

    -- Compute total count with filters (before pagination)
    SELECT COUNT(o.id) INTO v_total_count
    FROM public.marketplace_orders o
    WHERE (p_status = 'all' OR o.status = p_status)
      AND (p_start_date = '' OR o.created_at >= p_start_date::TIMESTAMPTZ)
      AND (p_end_date = '' OR o.created_at <= p_end_date::TIMESTAMPTZ)
      AND (
        v_clean_search = '' OR (
          unaccent(o.customer_name) ILIKE unaccent('%' || v_clean_search || '%') OR
          o.id::TEXT ILIKE '%' || v_clean_search || '%' OR
          o.customer_phone ILIKE '%' || v_clean_search || '%' OR
          unaccent(o.coupon_code) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(o.tracking_code) ILIKE unaccent('%' || v_clean_search || '%') OR
          EXISTS (
              SELECT 1 FROM public.marketplace_order_items oi
              WHERE oi.order_id = o.id 
                AND unaccent(oi.product_name) ILIKE unaccent('%' || v_clean_search || '%')
          )
        )
      );

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            o.*,
            (
                SELECT COALESCE(
                    jsonb_agg(
                        jsonb_build_object(
                            'id', oi.id,
                            'order_id', oi.order_id,
                            'product_id', oi.product_id,
                            'variant_id', oi.variant_id,
                            'quantity', oi.quantity,
                            'price', oi.price,
                            'product_name', oi.product_name,
                            'image_url', oi.image_url,
                            'product', (
                                SELECT jsonb_build_object(
                                    'imagem_url', p.imagem_url, 
                                    'imagem_urls', p.imagem_urls
                                )
                                FROM public.produtos p
                                WHERE p.id = oi.product_id
                            )
                        )
                    ),
                    '[]'::JSONB
                )
                FROM public.marketplace_order_items oi
                WHERE oi.order_id = o.id
            ) AS items,
            (
                SELECT to_jsonb(addr.*)
                FROM public.user_addresses addr
                WHERE addr.id = o.address_id
            ) AS address
        FROM public.marketplace_orders o
        WHERE (p_status = 'all' OR o.status = p_status)
          AND (p_start_date = '' OR o.created_at >= p_start_date::TIMESTAMPTZ)
          AND (p_end_date = '' OR o.created_at <= p_end_date::TIMESTAMPTZ)
          AND (
            v_clean_search = '' OR (
              unaccent(o.customer_name) ILIKE unaccent('%' || v_clean_search || '%') OR
              o.id::TEXT ILIKE '%' || v_clean_search || '%' OR
              o.customer_phone ILIKE '%' || v_clean_search || '%' OR
              unaccent(o.coupon_code) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(o.tracking_code) ILIKE unaccent('%' || v_clean_search || '%') OR
              EXISTS (
                  SELECT 1 FROM public.marketplace_order_items oi
                  WHERE oi.order_id = o.id 
                    AND unaccent(oi.product_name) ILIKE unaccent('%' || v_clean_search || '%')
              )
            )
          )
        ORDER BY o.created_at DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );
END;
$$;


--
-- Name: get_admin_products_paged("text", "text", "text", "text", integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_products_paged("p_search" "text" DEFAULT ''::"text", "p_category" "text" DEFAULT 'all'::"text", "p_status" "text" DEFAULT 'all'::"text", "p_stock" "text" DEFAULT 'all'::"text", "p_page" integer DEFAULT 0, "p_page_size" integer DEFAULT 10) RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

    -- Compute total count with filters (before pagination)
    SELECT COUNT(p.id) INTO v_total_count
    FROM public.produtos p
    WHERE p.deleted_at IS NULL
      AND (p_category = 'all' OR p.categoria = p_category)
      AND (p_status = 'all' OR (p_status = 'active' AND p.ativo = TRUE) OR (p_status = 'inactive' AND p.ativo = FALSE))
      AND (p_stock = 'all' OR (p_stock = 'low' AND p.estoque <= 5))
      AND (
        v_clean_search = '' OR (
          unaccent(p.nome) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(p.codigo) ILIKE unaccent('%' || v_clean_search || '%')
        )
      );

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            p.*,
            (
                SELECT COALESCE(
                    jsonb_agg(to_jsonb(v.*)),
                    '[]'::JSONB
                )
                FROM public.product_variants v
                WHERE v.product_id = p.id
            ) AS product_variants
        FROM public.produtos p
        WHERE p.deleted_at IS NULL
          AND (p_category = 'all' OR p.categoria = p_category)
          AND (p_status = 'all' OR (p_status = 'active' AND p.ativo = TRUE) OR (p_status = 'inactive' AND p.ativo = FALSE))
          AND (p_stock = 'all' OR (p_stock = 'low' AND p.estoque <= 5))
          AND (
            v_clean_search = '' OR (
              unaccent(p.nome) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(p.codigo) ILIKE unaccent('%' || v_clean_search || '%')
            )
          )
        ORDER BY p.data_cadastro DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );
END;
$$;


--
-- Name: get_admin_questions_paged("text", "text", integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_questions_paged("p_search" "text" DEFAULT ''::"text", "p_filter" "text" DEFAULT 'all'::"text", "p_page" integer DEFAULT 0, "p_page_size" integer DEFAULT 10) RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

    -- Compute total count with filters (before pagination)
    SELECT COUNT(q.id) INTO v_total_count
    FROM public.questions q
    LEFT JOIN public.profiles p ON p.id = q.user_id
    LEFT JOIN public.produtos prod ON prod.id = q.product_id
    WHERE (p_filter = 'all' OR NOT EXISTS (SELECT 1 FROM public.answers a WHERE a.question_id = q.id))
      AND (
        v_clean_search = '' OR (
          unaccent(q.question) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
        )
      );

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            q.*,
            (
                SELECT jsonb_build_object('full_name', p.full_name, 'avatar_url', p.avatar_url)
                FROM public.profiles p
                WHERE p.id = q.user_id
            ) AS "user",
            (
                SELECT jsonb_build_object('nome', prod.nome, 'imagem_url', prod.imagem_url)
                FROM public.produtos prod
                WHERE prod.id = q.product_id
            ) AS "product",
            (
                SELECT COALESCE(
                    jsonb_agg(to_jsonb(a.*) ORDER BY a.created_at ASC),
                    '[]'::JSONB
                )
                FROM public.answers a
                WHERE a.question_id = q.id
            ) AS answers,
            EXISTS (
                SELECT 1 
                FROM public.marketplace_orders o
                JOIN public.marketplace_order_items oi ON oi.order_id = o.id
                WHERE o.user_id = q.user_id
                  AND o.status = 'delivered'
                  AND oi.product_id = q.product_id
            ) AS is_verified
        FROM public.questions q
        LEFT JOIN public.profiles p ON p.id = q.user_id
        LEFT JOIN public.produtos prod ON prod.id = q.product_id
        WHERE (p_filter = 'all' OR NOT EXISTS (SELECT 1 FROM public.answers a WHERE a.question_id = q.id))
          AND (
            v_clean_search = '' OR (
              unaccent(q.question) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
            )
          )
        ORDER BY q.created_at DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );
END;
$$;


--
-- Name: get_admin_reviews_paged("text", "text", integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_reviews_paged("p_search" "text" DEFAULT ''::"text", "p_rating" "text" DEFAULT 'all'::"text", "p_page" integer DEFAULT 0, "p_page_size" integer DEFAULT 10) RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
    v_rating_val INTEGER;
    
    -- Metrics
    v_average_rating NUMERIC;
    v_total_verified BIGINT;
    v_total_replied BIGINT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);
    
    IF p_rating = 'all' THEN
        v_rating_val := NULL;
    ELSE
        v_rating_val := p_rating::INTEGER;
    END IF;

    -- Compute total count and metrics in a single query block
    SELECT 
        COUNT(r.id),
        COALESCE(AVG(r.rating), 0.0),
        COUNT(CASE WHEN r.verified = true THEN 1 END),
        COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)
    INTO 
        v_total_count,
        v_average_rating,
        v_total_verified,
        v_total_replied
    FROM public.reviews r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN public.produtos prod ON prod.id = r.product_id
    WHERE (v_rating_val IS NULL OR r.rating = v_rating_val)
      AND (
        v_clean_search = '' OR (
          unaccent(r.comment) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
        )
      );

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            r.*,
            (
                SELECT jsonb_build_object('full_name', p.full_name)
                FROM public.profiles p
                WHERE p.id = r.user_id
            ) AS "user",
            (
                SELECT jsonb_build_object('nome', prod.nome)
                FROM public.produtos prod
                WHERE prod.id = r.product_id
            ) AS "product"
        FROM public.reviews r
        LEFT JOIN public.profiles p ON p.id = r.user_id
        LEFT JOIN public.produtos prod ON prod.id = r.product_id
        WHERE (v_rating_val IS NULL OR r.rating = v_rating_val)
          AND (
            v_clean_search = '' OR (
              unaccent(r.comment) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
            )
          )
        ORDER BY r.created_at DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'average_rating', v_average_rating,
        'total_verified', v_total_verified,
        'total_replied', v_total_replied
    );
END;
$$;


--
-- Name: get_admin_user_detail("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_admin_user_detail("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_profile JSONB;
    v_orders JSONB;
    v_cart_items JSONB;
    v_addresses JSONB;
BEGIN
    -- SECURITY CHECK: Admin only
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- 1. Fetch profile info (join auth.users to get email)
    SELECT JSONB_BUILD_OBJECT(
        'id', p.id,
        'full_name', p.full_name,
        'avatar_url', p.avatar_url,
        'whatsapp', p.whatsapp,
        'role', p.role,
        'created_at', p.created_at,
        'email', u.email
    ) INTO v_profile
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_user_id;

    -- 2. Fetch marketplace orders (including order items)
    SELECT COALESCE(JSONB_AGG(o_data), '[]'::JSONB) INTO v_orders
    FROM (
        SELECT 
            mo.*,
            COALESCE(
                (
                    SELECT JSONB_AGG(item) 
                    FROM public.marketplace_order_items item 
                    WHERE item.order_id = mo.id
                ), 
                '[]'::JSONB
            ) as items
        FROM public.marketplace_orders mo
        WHERE mo.user_id = p_user_id
        ORDER BY mo.created_at DESC
    ) o_data;

    -- 3. Fetch cart items
    SELECT COALESCE(JSONB_AGG(c), '[]'::JSONB) INTO v_cart_items
    FROM public.cart_items c
    WHERE c.user_id = p_user_id;

    -- 4. Fetch user addresses
    SELECT COALESCE(JSONB_AGG(a), '[]'::JSONB) INTO v_addresses
    FROM public.user_addresses a
    WHERE a.user_id = p_user_id;

    -- Return Consolidated Object
    RETURN JSONB_BUILD_OBJECT(
        'profile', v_profile,
        'orders', v_orders,
        'cart_items', v_cart_items,
        'addresses', v_addresses
    );
END;
$$;


--
-- Name: get_category_analytics(timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_category_analytics("start_date" timestamp with time zone, "end_date" timestamp with time zone) RETURNS TABLE("name" "text", "value" numeric, "orders" bigint, "avg_ticket" numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- Guarda de autorização: SECURITY DEFINER ignora o RLS das três tabelas
    -- abaixo, então quem autoriza é esta linha.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    RETURN QUERY
    WITH category_sums AS (
        SELECT
            COALESCE(p.categoria, 'Geral')::text as name,
            SUM(oi.price * oi.quantity)::numeric as value,
            COUNT(DISTINCT o.id)::bigint as orders,
            CASE
                WHEN COUNT(DISTINCT o.id) > 0 THEN
                    ROUND((SUM(oi.price * oi.quantity) / COUNT(DISTINCT o.id))::numeric, 2)
                ELSE 0
            END as avg_ticket
        FROM public.marketplace_order_items oi
        JOIN public.produtos p ON oi.product_id = p.id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        WHERE o.created_at >= start_date AND o.created_at <= end_date
          AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY COALESCE(p.categoria, 'Geral')

        UNION ALL

        SELECT
            'Frete'::text as name,
            SUM(o.shipping)::numeric as value,
            COUNT(DISTINCT o.id)::bigint as orders,
            CASE
                WHEN COUNT(DISTINCT o.id) > 0 THEN
                    ROUND((SUM(o.shipping) / COUNT(DISTINCT o.id))::numeric, 2)
                ELSE 0
            END as avg_ticket
        FROM public.marketplace_orders o
        WHERE o.created_at >= start_date AND o.created_at <= end_date
          AND o.status NOT IN ('cancelled', 'returned')
          AND COALESCE(o.shipping, 0) > 0
    )
    SELECT cs.name, cs.value, cs.orders, cs.avg_ticket
    FROM category_sums cs
    ORDER BY cs.value DESC;
END;
$$;


--
-- Name: get_category_sales("text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_category_sales("start_date" "text", "end_date" "text") RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    result JSON;
BEGIN
    -- Security Check
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    SELECT json_agg(t) INTO result
    FROM (
        SELECT 
            COALESCE(p.categoria, 'Sem Categoria') as category,
            SUM(oi.quantity * oi.price)::NUMERIC as value
        FROM public.marketplace_orders o
        JOIN public.marketplace_order_items oi ON o.id = oi.order_id
        JOIN public.produtos p ON p.id = oi.product_id
        WHERE o.created_at >= start_date::TIMESTAMPTZ 
          AND o.created_at <= end_date::TIMESTAMPTZ
          AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY p.categoria
        ORDER BY value DESC
    ) t;

    RETURN COALESCE(result, '[]'::json);
END;
$$;


--
-- Name: get_coupon_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_coupon_stats() RETURNS TABLE("total_coupons" bigint, "active_coupons" bigint, "total_uses" bigint, "avg_discount" numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT,
        COUNT(*) FILTER (WHERE active = true)::BIGINT,
        COALESCE(SUM(usage_count), 0)::BIGINT,
        COALESCE(AVG(value), 0)::NUMERIC
    FROM public.coupons;
END;
$$;


--
-- Name: get_customer_intelligence(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_customer_intelligence() RETURNS TABLE("customer_id" "uuid", "customer_name" "text", "total_spent" numeric, "order_count" bigint, "last_order_at" timestamp with time zone, "ltv_score" numeric, "is_push_subscribed" boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: Dados sensíveis.';
    END IF;

    RETURN QUERY
    SELECT 
        p.id as customer_id,
        p.full_name as customer_name,
        COALESCE(SUM(o.total_amount), 0)::numeric as total_spent,
        COUNT(o.id) as order_count,
        MAX(o.created_at) as last_order_at,
        (COALESCE(SUM(o.total_amount), 0) * 0.7 + COUNT(o.id) * 0.3)::numeric as ltv_score,
        EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = p.id) as is_push_subscribed
    FROM public.profiles p
    LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')
    GROUP BY p.id, p.full_name
    ORDER BY ltv_score DESC
    LIMIT 20;
END;
$$;


--
-- Name: get_inventory_health(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inventory_health() RETURNS TABLE("product_id" "uuid", "product_name" "text", "current_stock" integer, "sales_last_30d" bigint, "days_remaining" numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;
    RETURN QUERY
    WITH product_sales AS (
        SELECT oi.product_id, SUM(oi.quantity) as total_qty
        FROM public.marketplace_order_items oi
        JOIN public.marketplace_orders o ON o.id = oi.order_id
        WHERE o.created_at >= NOW() - INTERVAL '30 days' AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY oi.product_id
    )
    SELECT 
        p.id as product_id, p.nome as product_name, p.estoque as current_stock,
        COALESCE(ps.total_qty, 0) as sales_last_30d,
        CASE WHEN ps.total_qty IS NULL OR ps.total_qty = 0 THEN 999 ELSE (p.estoque::NUMERIC / (ps.total_qty::NUMERIC / 30.0)) END as days_remaining
    FROM public.produtos p
    LEFT JOIN product_sales ps ON ps.product_id = p.id
    WHERE p.estoque < 20 OR (ps.total_qty > 0 AND (p.estoque::NUMERIC / (ps.total_qty::NUMERIC / 30.0)) < 7)
    ORDER BY days_remaining ASC;
END;
$$;


--
-- Name: get_my_complete_profile(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_complete_profile() RETURNS TABLE("id" "uuid", "full_name" "text", "whatsapp" "text", "role" "text", "avatar_url" "text", "created_at" timestamp with time zone, "cover_url" "text")
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id, 
        p.full_name, 
        p.whatsapp, 
        p.role, 
        p.avatar_url, 
        p.created_at,
        p.cover_url
    FROM profiles p
    WHERE p.id = auth.uid();
END;
$$;


--
-- Name: FUNCTION get_my_complete_profile(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_my_complete_profile() IS 'Returns the authenticated user''s profile, including the cover_url field.';


--
-- Name: get_orders_by_otp_v1("text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_orders_by_otp_v1("p_email" "text", "p_otp" "text") RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_rec RECORD;
    v_max_tentativas CONSTANT integer := 5;
BEGIN
    -- Busca pelo e-mail, NÃO por e-mail + código: com o código errado não
    -- haveria linha para incrementar, e o contador nunca sairia do lugar.
    SELECT * INTO v_rec
      FROM public.otp_verifications
     WHERE email = trim(p_email)
       AND expires_at > NOW()
       AND verified = false
     ORDER BY created_at DESC
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Código inválido ou expirado.');
    END IF;

    IF v_rec.attempts >= v_max_tentativas THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Código bloqueado por excesso de tentativas. Peça um novo.');
    END IF;

    IF v_rec.otp_code IS DISTINCT FROM p_otp THEN
        UPDATE public.otp_verifications
           SET attempts = attempts + 1
         WHERE id = v_rec.id;
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'Código inválido ou expirado.',
            'restantes', v_max_tentativas - (v_rec.attempts + 1)
        );
    END IF;

    UPDATE public.otp_verifications SET verified = TRUE WHERE id = v_rec.id;

    -- Um pedido, o que o código comprou. Nunca a lista por e-mail ou WhatsApp.
    RETURN jsonb_build_object(
        'ok', true,
        'orders', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', o.id,
                'user_id', o.user_id,
                'total', o.total,
                'subtotal', o.subtotal,
                'shipping', o.shipping,
                'discount', o.discount,
                'payment_method', o.payment_method,
                'status', o.status,
                'notes', o.notes,
                'coupon_code', o.coupon_code,
                'tracking_code', o.tracking_code,
                'created_at', o.created_at,
                'updated_at', o.updated_at,
                'customer_name', o.customer_name,
                'customer_data', o.customer_data,
                'items', (
                    SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'id', oi.id,
                        'order_id', oi.order_id,
                        'product_id', oi.product_id,
                        'variant_id', oi.variant_id,
                        'quantity', oi.quantity,
                        'price', oi.price,
                        'product_name', oi.product_name,
                        'image_url', oi.image_url
                    )), '[]'::jsonb)
                      FROM public.marketplace_order_items oi
                     WHERE oi.order_id = o.id
                ),
                'address', (
                    SELECT to_jsonb(addr.*)
                      FROM public.user_addresses addr
                     WHERE addr.id = o.address_id
                )
            )), '[]'::jsonb)
              FROM public.marketplace_orders o
             WHERE o.id = v_rec.order_id
        )
    );
END;
$$;


--
-- Name: get_orders_by_whatsapp_v3("text", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_orders_by_whatsapp_v3("p_phone_number" "text", "p_customer_email" "text", "p_order_fragment" "text") RETURNS SETOF "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_user_id UUID;
BEGIN
    IF LENGTH(p_order_fragment) < 4 THEN
        RAISE EXCEPTION 'Fragmento muito curto. Informe pelo menos 4 dígitos.';
    END IF;

    SELECT id INTO v_user_id 
    FROM auth.users 
    WHERE (phone = p_phone_number OR raw_user_meta_data->>'whatsapp' = p_phone_number) 
      AND email = p_customer_email;

    IF v_user_id IS NULL THEN RETURN; END IF;

    RETURN QUERY 
    SELECT 
        jsonb_build_object(
            'id', o.id,
            'user_id', o.user_id,
            'total', o.total,
            'subtotal', o.subtotal,
            'shipping', o.shipping,
            'discount', o.discount,
            'payment_method', o.payment_method,
            'status', o.status,
            'notes', o.notes,
            'coupon_code', o.coupon_code,
            'tracking_code', o.tracking_code,
            'created_at', o.created_at,
            'updated_at', o.updated_at,
            'customer_name', o.customer_name,
            'customer_data', o.customer_data,
            'items', (
                SELECT COALESCE(
                    jsonb_agg(
                        jsonb_build_object(
                            'id', oi.id,
                            'order_id', oi.order_id,
                            'product_id', oi.product_id,
                            'variant_id', oi.variant_id,
                            'quantity', oi.quantity,
                            'price', oi.price,
                            'product_name', oi.product_name,
                            'image_url', oi.image_url
                        )
                    ),
                    '[]'::jsonb
                )
                FROM public.marketplace_order_items oi
                WHERE oi.order_id = o.id
            ),
            'address', (
                SELECT to_jsonb(addr.*)
                FROM public.user_addresses addr
                WHERE addr.id = o.address_id
            )
        )
    FROM public.marketplace_orders o
    WHERE o.user_id = v_user_id
    AND (o.id::text LIKE '%' || p_order_fragment OR o.tracking_code LIKE '%' || p_order_fragment)
    ORDER BY o.created_at DESC;
END;
$$;


--
-- Name: get_product_optimization_data(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_product_optimization_data() RETURNS TABLE("id" "uuid", "name" "text", "current_min" integer, "velocity" numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    RETURN QUERY
    WITH sales_90d AS (
        SELECT 
            oi.product_id,
            SUM(oi.quantity)::numeric / 90.0 as daily_velocity
        FROM marketplace_order_items oi
        JOIN marketplace_orders o ON oi.order_id = o.id
        WHERE o.created_at >= NOW() - INTERVAL '90 days'
        AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY oi.product_id
    )
    SELECT 
        p.id,
        p.nome as name,
        COALESCE(p.estoque_minimo, 0) as current_min,
        COALESCE(s.daily_velocity, 0)::numeric as velocity
    FROM produtos p
    LEFT JOIN sales_90d s ON p.id = s.product_id
    WHERE COALESCE(s.daily_velocity, 0) > 0 OR p.estoque < COALESCE(p.estoque_minimo, 0);
END;
$$;


--
-- Name: get_product_recommendations("uuid", integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_product_recommendations("p_product_id" "uuid", "p_limit" integer DEFAULT 4) RETURNS SETOF "public"."produtos"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_category text;
    v_tags text[];
BEGIN
    -- Get context from current product
    SELECT categoria, tags INTO v_category, v_tags
    FROM produtos
    WHERE id = p_product_id;

    RETURN QUERY
    SELECT *
    FROM produtos p
    WHERE p.id != p_product_id
      AND p.ativo = true
      AND p.estoque > 0
      AND (
          -- Exact category match (High weight)
          p.categoria = v_category
          OR
          -- Tag overlap (Medium weight)
          p.tags && v_tags
      )
    -- Simple scoring: Category match is prioritized
    ORDER BY 
        (p.categoria = v_category) DESC,
        p.data_cadastro DESC
    LIMIT p_limit;
END;
$$;


--
-- Name: get_product_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_product_stats() RETURNS SETOF "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- Segurança: Dados de custo e performance de vendas são restritos.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: Administradores apenas.';
    END IF;

    RETURN QUERY
    SELECT jsonb_build_object(
        'id', p.id,
        'nome', p.nome,
        'descricao', p.descricao,
        'categoria', p.categoria,
        'preco_venda', p.preco_venda,
        'custo', p.custo,
        'estoque', p.estoque,
        'ativo', p.ativo,
        'imagem_url', p.imagem_url,
        'tags', p.tags,
        'sold', COALESCE(SUM(i.quantity), 0),
        'created_at', p.data_cadastro,
        'product_variants', (
            SELECT jsonb_agg(v)
            FROM public.product_variants v
            WHERE v.product_id = p.id
        )
    )
    FROM public.produtos p
    LEFT JOIN public.marketplace_order_items i ON i.product_id = p.id
    GROUP BY p.id
    ORDER BY p.nome;
END;
$$;


--
-- Name: get_products_with_variants(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_products_with_variants() RETURNS SETOF "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        jsonb_build_object(
            'id', p.id,
            'nome', p.nome,
            'descricao', p.descricao,
            'preco_venda', p.preco_venda,
            'preco_original', p.preco_original,
            'imagem_url', p.imagem_url,
            'imagem_urls', p.imagem_urls,
            'categoria', p.categoria,
            'estoque', p.estoque,
            'sold', p.sold,
            'ativo', p.ativo,
            'is_bestseller', p.is_bestseller,
            'frete_gratis', p.frete_gratis,
            'data_cadastro', p.data_cadastro,
            'tags', p.tags,
            'meta_title', p.meta_title,
            'meta_description', p.meta_description,
            'rating', p.rating,
            'review_count', p.review_count,
            'calculated_points', p.calculated_points,
            'product_variants', COALESCE(
                (SELECT jsonb_agg(v) 
                 FROM (
                     SELECT 
                        id, 
                        product_id, 
                        sku, 
                        name, 
                        value, 
                        stock_increment, 
                        price_override, 
                        active 
                     FROM public.product_variants 
                     WHERE product_id = p.id AND active = true
                     ORDER BY name ASC
                 ) v
                ), '[]'::jsonb
            )
        )
    FROM public.vw_produtos_public p
    ORDER BY p.data_cadastro DESC;
END;
$$;


--
-- Name: get_retention_analytics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_retention_analytics() RETURNS TABLE("month" "text", "total_customers" bigint, "returning_customers" bigint, "retention_rate" numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado.';
    END IF;

    RETURN QUERY
    WITH monthly_users AS (
        SELECT TO_CHAR(created_at, 'YYYY-MM') as active_month, user_id
        FROM public.marketplace_orders
        WHERE status NOT IN ('cancelled')
        GROUP BY 1, 2
    ),
    retention AS (
        SELECT 
            curr.active_month,
            COUNT(DISTINCT curr.user_id)::bigint as total_users,
            COUNT(DISTINCT prev.user_id)::bigint as returning_users
        FROM monthly_users curr
        LEFT JOIN monthly_users prev ON curr.user_id = prev.user_id 
            AND prev.active_month = TO_CHAR(TO_DATE(curr.active_month, 'YYYY-MM') - INTERVAL '1 month', 'YYYY-MM')
        GROUP BY 1
    )
    SELECT active_month, total_users, returning_users, ROUND((returning_users::NUMERIC / GREATEST(total_users, 1) * 100), 1) as retention_rate
    FROM retention
    ORDER BY active_month DESC;
END;
$$;


--
-- Name: get_retention_analytics(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_retention_analytics("p_days" integer DEFAULT 90) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_total_customers int;
    v_repeat_customers int;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    WITH customer_counts AS (
        SELECT 
            COALESCE(user_id::text, customer_data->>'whatsapp') as customer_id,
            COUNT(*) as order_count
        FROM marketplace_orders
        WHERE created_at >= NOW() - (p_days || ' days')::interval
        AND status NOT IN ('cancelled', 'returned')
        GROUP BY customer_id
    )
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE order_count > 1)
    INTO v_total_customers, v_repeat_customers
    FROM customer_counts;

    IF v_total_customers = 0 THEN
        RETURN 0;
    END IF;

    RETURN (v_repeat_customers::numeric / v_total_customers::numeric) * 100;
END;
$$;


--
-- Name: get_retention_rate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_retention_rate() RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    total_customers bigint := 0;
    repeated_customers bigint := 0;
    retention_rate numeric := 0;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado.';
    END IF;

    SELECT count(DISTINCT user_id) INTO total_customers
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned');

    IF total_customers > 0 THEN
        WITH order_counts AS (
            SELECT count(*) AS purchase_count FROM public.marketplace_orders
            WHERE status NOT IN ('cancelled', 'returned') GROUP BY user_id
        )
        SELECT count(*) INTO repeated_customers FROM order_counts WHERE purchase_count > 1;
        retention_rate := (repeated_customers::numeric / total_customers::numeric) * 100.0;
    END IF;

    RETURN round(retention_rate, 1);
END;
$$;


--
-- Name: get_reviews_metrics("text", integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_reviews_metrics("p_search" "text" DEFAULT NULL::"text", "p_rating" integer DEFAULT NULL::integer) RETURNS TABLE("average_rating" numeric, "total_verified" bigint, "total_replied" bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_search_pattern text;
  v_profile_ids uuid[];
  v_product_ids uuid[];
BEGIN
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_search_pattern := '%' || p_search || '%';
    
    SELECT COALESCE(array_agg(id), '{}') INTO v_profile_ids 
    FROM public_profiles 
    WHERE full_name ILIKE v_search_pattern;
    
    SELECT COALESCE(array_agg(id), '{}') INTO v_product_ids 
    FROM produtos 
    WHERE nome ILIKE v_search_pattern;
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(AVG(r.rating), 0.0)::numeric as average_rating,
    COUNT(CASE WHEN r.verified = true THEN 1 END)::bigint as total_verified,
    COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)::bigint as total_replied
  FROM reviews r
  WHERE 
    (p_rating IS NULL OR r.rating = p_rating)
    AND (
      p_search IS NULL OR p_search = '' 
      OR r.comment ILIKE v_search_pattern
      OR (v_profile_ids IS NOT NULL AND r.user_id = ANY(v_profile_ids))
      OR (v_product_ids IS NOT NULL AND r.product_id = ANY(v_product_ids))
    );
END;
$$;


--
-- Name: get_sales_analytics(timestamp without time zone, timestamp without time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_sales_analytics("start_date" timestamp without time zone, "end_date" timestamp without time zone) RETURNS TABLE("day" timestamp without time zone, "orders" bigint, "revenue" numeric, "ticket" numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT 
    sales_day,
    total_orders,
    gross_revenue::numeric,
    average_ticket::numeric
  FROM public.sales_overview
  WHERE sales_day >= start_date AND sales_day <= end_date;
END;
$$;


--
-- Name: get_sales_analytics(timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_sales_analytics("start_date" timestamp with time zone, "end_date" timestamp with time zone) RETURNS TABLE("day" timestamp with time zone, "orders" bigint, "revenue" numeric, "ticket" numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Segurança: Dados financeiros.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT 
    sales_day,
    total_orders,
    gross_revenue::numeric,
    average_ticket::numeric
  FROM public.sales_overview
  WHERE sales_day >= start_date AND sales_day <= end_date;
END;
$$;


--
-- Name: get_segmented_push_targets("text", numeric, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_segmented_push_targets("p_segment" "text" DEFAULT 'all'::"text", "p_min_ltv" numeric DEFAULT 150, "p_days_inactive" integer DEFAULT 30) RETURNS TABLE("auth" "text", "endpoint" "text", "p256dh" "text", "user_id" "uuid")
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- Case 1: Specific User (UUID format)
    IF p_segment ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s
        WHERE s.user_id = p_segment::uuid;

    -- Case 2: VIP Segment (Users with LTV >= p_min_ltv)
    ELSIF p_segment = 'vip' THEN
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s
        WHERE s.user_id IN (
            SELECT o.user_id
            FROM public.marketplace_orders o
            WHERE o.status NOT IN ('cancelled', 'returned')
            GROUP BY o.user_id
            HAVING SUM(o.total::numeric) >= p_min_ltv
        );

    -- Case 3: Inactive Segment (Inactive for >= p_days_inactive)
    ELSIF p_segment = 'inactive' THEN
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s
        WHERE s.user_id IN (
            -- Users whose last order was more than X days ago
            SELECT o.user_id
            FROM public.marketplace_orders o
            GROUP BY o.user_id
            HAVING MAX(o.created_at) < NOW() - (p_days_inactive || ' days')::interval
        ) OR s.user_id IN (
            -- Users who registered more than X days ago and have never ordered
            SELECT p.id
            FROM public.profiles p
            LEFT JOIN public.marketplace_orders o ON o.user_id = p.id
            WHERE p.created_at < NOW() - (p_days_inactive || ' days')::interval
              AND o.id IS NULL
        );

    -- Case 4: New Clients Segment (Created within the last 7 days)
    ELSIF p_segment = 'new' THEN
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s
        WHERE s.user_id IN (
            SELECT p.id
            FROM public.profiles p
            WHERE p.created_at >= NOW() - INTERVAL '7 days'
        );

    -- Case 5: All (Default fallback)
    ELSE
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s;
    END IF;
END;
$_$;


--
-- Name: handle_default_address(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_default_address() RETURNS "trigger"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE public.user_addresses
    SET is_default = false
    WHERE user_id = NEW.user_id AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: handle_new_otp_verification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_otp_verification() RETURNS "trigger"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_chave text;
BEGIN
    SELECT decrypted_secret
      INTO v_chave
      FROM vault.decrypted_secrets
     WHERE name = 'otp_trigger_secret';

    -- Não postar com Bearer vazio: a edge function devolveria 401 e o convidado
    -- veria "enviamos o código" sem receber nada. Ver o cabeçalho.
    IF coalesce(v_chave, '') = '' THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Código de verificação não enviado: segredo "otp_trigger_secret" ausente no Vault.',
            HINT    = 'Restaure o segredo. Enquanto ele faltar, o código não chega ao cliente e por isso a solicitação falha aqui, em vez de prometer entrega.';
    END IF;

    PERFORM net.http_post(
        url := 'https://cafkrminfnokvgjqtkle.functions.supabase.co/send-otp-email',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_chave
        ),
        body := jsonb_build_object(
            'type', 'INSERT',
            'table', 'otp_verifications',
            'record', row_to_json(NEW)::jsonb
        )
    );

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION handle_new_otp_verification(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.handle_new_otp_verification() IS 'Dispara send-otp-email no projeto cafkrminfnokvgjqtkle. Entre 08/07 e 05/08/2026 o corpo vivo apontava para jvgyjlbjhbfrncwbytls, onde a função não existe — todo POST era 404. A credencial sai do Vault (otp_trigger_secret), um segredo criado só para este uso — não a service_role; app_settings e o header apikey não são mais consultados. Ver #41, #85, #86.';


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS "trigger"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, whatsapp, cpf, role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Usuário'),
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'cpf',
    'customer'
  )
  ON CONFLICT (id) DO UPDATE
  SET
    full_name = EXCLUDED.full_name,
    whatsapp = COALESCE(EXCLUDED.whatsapp, profiles.whatsapp),
    cpf = COALESCE(EXCLUDED.cpf, profiles.cpf);
  RETURN new;
END;
$$;


--
-- Name: handle_order_item_stock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_order_item_stock() RETURNS "trigger"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_current_stock INTEGER;
BEGIN
    IF NEW.variant_id IS NOT NULL THEN
        SELECT stock INTO v_current_stock FROM public.product_variants WHERE id = NEW.variant_id FOR UPDATE;
        IF v_current_stock < NEW.quantity THEN
            RAISE EXCEPTION 'Estoque insuficiente para a variante.';
        END IF;
        UPDATE public.product_variants SET stock = stock - NEW.quantity WHERE id = NEW.variant_id;
    ELSE
        SELECT estoque INTO v_current_stock FROM public.produtos WHERE id = NEW.product_id FOR UPDATE;
        IF v_current_stock < NEW.quantity THEN
            RAISE EXCEPTION 'Estoque insuficiente para o produto.';
        END IF;
        UPDATE public.produtos SET estoque = estoque - NEW.quantity WHERE id = NEW.product_id;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: handle_profile_role_sync_to_auth(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_profile_role_sync_to_auth() RETURNS "trigger"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
BEGIN
    UPDATE auth.users
    SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', NEW.role)
    WHERE id = NEW.id;
    RETURN NEW;
END;
$$;


--
-- Name: handle_public_profile_sync(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_public_profile_sync() RETURNS "trigger"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.public_profiles (id, full_name, avatar_url, created_at, cover_url)
        VALUES (NEW.id, NEW.full_name, NEW.avatar_url, NEW.created_at, NEW.cover_url)
        ON CONFLICT (id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            avatar_url = EXCLUDED.avatar_url,
            cover_url = EXCLUDED.cover_url;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.public_profiles (id, full_name, avatar_url, created_at, cover_url)
        VALUES (NEW.id, NEW.full_name, NEW.avatar_url, NEW.created_at, NEW.cover_url)
        ON CONFLICT (id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            avatar_url = EXCLUDED.avatar_url,
            cover_url = EXCLUDED.cover_url;
    ELSIF TG_OP = 'DELETE' THEN
        DELETE FROM public.public_profiles WHERE id = OLD.id;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: handle_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_updated_at() RETURNS "trigger"
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: increment_helpful("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_helpful("review_id" "uuid") RETURNS "void"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
    END IF;

    UPDATE public.reviews 
    SET helpful = COALESCE(helpful, 0) + 1 
    WHERE id = review_id;
END;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
  v_role text;
BEGIN
  -- Se executado na sessão como postgres/service_role diretamente, autorizar
  IF current_setting('role', true) IN ('postgres', 'service_role') THEN
    RETURN true;
  END IF;

  -- 1º tentar ler dos claims do JWT (mais rápido)
  IF (current_setting('request.jwt.claims', true) IS NOT NULL AND current_setting('request.jwt.claims', true) <> '') THEN
    v_role := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role');
    IF v_role = 'admin' THEN
      RETURN true;
    END IF;
  END IF;

  -- 2º Fallback: consultar a tabela auth.users diretamente (sem RLS)
  RETURN EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = (SELECT auth.uid())
    AND (raw_app_meta_data ->> 'role') = 'admin'
  );
END;
$$;


--
-- Name: is_local_cep("text", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_local_cep("p_origin_cep" "text", "p_dest_cep" "text", "p_local_cep_range" "text") RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: prevent_role_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_role_change() RETURNS "trigger"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- Allow admins to change roles
    IF public.is_admin() THEN
        RETURN NEW;
    END IF;

    -- Block role change for normal users
    IF (OLD.role IS DISTINCT FROM NEW.role) THEN
        RAISE EXCEPTION 'Unauthorized: You cannot change your own role.';
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: record_vor_action("text", "jsonb", "jsonb", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_vor_action("p_action_type" "text", "p_input_data" "jsonb", "p_output_data" "jsonb", "p_proof_hash" "text") RETURNS "void"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_previous_hash TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: Apenas o sistema ERP/Admin pode gravar recibos VOR diretamente.';
    END IF;

    -- Lock table to ensure sequentiality
    LOCK TABLE public.vor_receipts IN EXCLUSIVE MODE;

    SELECT proof_hash INTO v_previous_hash 
    FROM public.vor_receipts 
    ORDER BY created_at DESC 
    LIMIT 1;

    INSERT INTO public.vor_receipts (
        action_type, input_data, output_data, proof_hash, previous_hash
    ) VALUES (
        p_action_type, p_input_data, p_output_data, p_proof_hash, COALESCE(v_previous_hash, 'GENESIS_BLOCK_G19')
    );
END;
$$;


--
-- Name: reply_review_atomic("uuid", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reply_review_atomic("p_review_id" "uuid", "p_reply" "text") RETURNS "void"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

        -- 2. Log Notification for Admin Visibility
        INSERT INTO push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua avaliação foi respondida!', 
            'A loja respondeu à sua avaliação no produto ' || COALESCE(v_product_name, 'comprado') || '.', 
            '/product/' || v_product_id, 
            1, 
            v_admin_id
        );
    END IF;
END;
$$;


--
-- Name: reply_review_atomic("uuid", "text", "uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reply_review_atomic("p_review_id" "uuid", "p_reply" "text", "p_admin_id" "uuid") RETURNS "void"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
BEGIN
    -- SECURITY CHECK: Reject any caller that is not an admin
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can reply to reviews.';
    END IF;

    -- 1. Update Review
    UPDATE public.reviews 
    SET merchant_reply = p_reply, merchant_reply_at = NOW() 
    WHERE id = p_review_id
    RETURNING user_id, product_id INTO v_user_id, v_product_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM public.produtos WHERE id = v_product_id;

        -- 2. Log Notification for Admin Visibility (Using p_admin_id as creator)
        INSERT INTO public.push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua avaliacao foi respondida!', 
            'A loja respondeu a sua avaliacao no produto ' || COALESCE(v_product_name, 'comprado') || '.', 
            '/product/' || v_product_id, 
            1, 
            p_admin_id
        );
    END IF;
END;
$$;


--
-- Name: swap_banner_order("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.swap_banner_order("banner_id_1" "uuid", "banner_id_2" "uuid") RETURNS "void"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    order_1 INTEGER; order_2 INTEGER;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;
    SELECT "order" INTO order_1 FROM public.banners WHERE id = banner_id_1;
    SELECT "order" INTO order_2 FROM public.banners WHERE id = banner_id_2;
    IF order_1 IS NULL OR order_2 IS NULL THEN RAISE EXCEPTION 'Banner não encontrado.'; END IF;
    UPDATE public.banners SET "order" = order_2 WHERE id = banner_id_1;
    UPDATE public.banners SET "order" = order_1 WHERE id = banner_id_2;
END;
$$;


--
-- Name: sync_cart_atomic("jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_cart_atomic("p_cart_items" "jsonb") RETURNS "void"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_user_id uuid;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Delete existing items
    DELETE FROM public.cart_items
    WHERE user_id = v_user_id;

    -- Insert new items, grouping by product and variant to prevent duplicates
    -- and summing quantities if the payload somehow contains the same item twice.
    -- Accept client-provided updated_at for LWW conflict resolution;
    -- fall back to NOW() if the client omits it.
    INSERT INTO public.cart_items (user_id, product_id, variant_id, quantity, updated_at)
    SELECT 
        v_user_id,
        (item->>'product_id')::text,
        COALESCE(item->>'variant_id', '')::text,
        SUM((item->>'quantity')::integer),
        COALESCE(MAX((item->>'updated_at')::timestamptz), NOW())
    FROM jsonb_array_elements(p_cart_items) AS item
    GROUP BY 1, 2, 3;

END;
$$;


--
-- Name: tr_prevent_role_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tr_prevent_role_change() RETURNS "trigger"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF (OLD.role <> NEW.role) AND NOT (SELECT is_admin()) THEN
        NEW.role := OLD.role;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: update_my_profile_secure("text", "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_my_profile_secure("p_full_name" "text" DEFAULT NULL::"text", "p_whatsapp" "text" DEFAULT NULL::"text", "p_avatar_url" "text" DEFAULT NULL::"text", "p_cover_url" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    UPDATE profiles
    SET 
        full_name = COALESCE(p_full_name, full_name),
        whatsapp = COALESCE(p_whatsapp, whatsapp),
        avatar_url = CASE 
            WHEN p_avatar_url = 'REMOVE' THEN NULL 
            ELSE COALESCE(p_avatar_url, avatar_url) 
        END,
        cover_url = CASE 
            WHEN p_cover_url = 'REMOVE' THEN NULL 
            ELSE COALESCE(p_cover_url, cover_url) 
        END,
        updated_at = NOW()
    WHERE id = auth.uid();
END;
$$;


--
-- Name: FUNCTION update_my_profile_secure("p_full_name" "text", "p_whatsapp" "text", "p_avatar_url" "text", "p_cover_url" "text"); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_my_profile_secure("p_full_name" "text", "p_whatsapp" "text", "p_avatar_url" "text", "p_cover_url" "text") IS 'Updates the profile of the authenticated user including avatar_url and cover_url.';


--
-- Name: update_order_status_atomic("uuid", "text", "text", boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_order_status_atomic("p_order_id" "uuid", "p_new_status" "text", "p_notes" "text" DEFAULT NULL::"text", "p_silent" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_old_status TEXT;
    v_user_id UUID;
    v_caller_id UUID := auth.uid();
    v_is_admin BOOLEAN := public.is_admin();
    v_item RECORD;
    v_result jsonb;
BEGIN
    -- Antes de qualquer leitura: sem sessão, nem existência de pedido se revela.
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Não autorizado: é preciso estar autenticado para alterar um pedido.';
    END IF;

    -- Get current status and lock row
    SELECT status, user_id INTO v_old_status, v_user_id
    FROM public.marketplace_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_old_status IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Security checks
    -- IS DISTINCT FROM, não `!=`: pedido de convidado tem user_id NULL, e
    -- `NULL != <uuid>` avalia para NULL — o IF não dispararia.
    IF v_user_id IS DISTINCT FROM v_caller_id AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Não autorizado: Você não tem permissão para alterar este pedido.';
    END IF;

    IF NOT v_is_admin THEN
        IF p_new_status IS DISTINCT FROM 'cancelled' THEN
            RAISE EXCEPTION 'Operação não permitida: Usuários só podem cancelar seus próprios pedidos.';
        END IF;
        IF v_old_status IS DISTINCT FROM 'pending' THEN
            RAISE EXCEPTION 'Apenas pedidos pendentes podem ser cancelados pelo usuário.';
        END IF;
    END IF;

    -- STOCK RESTORATION LOGIC
    -- If transitioning to 'cancelled' from a non-cancelled status
    IF p_new_status = 'cancelled' AND v_old_status IS DISTINCT FROM 'cancelled' THEN
        FOR v_item IN SELECT product_id, variant_id, quantity FROM public.marketplace_order_items WHERE order_id = p_order_id
        LOOP
            IF v_item.variant_id IS NOT NULL THEN
                UPDATE public.product_variants
                SET stock_increment = stock_increment + v_item.quantity
                WHERE id = v_item.variant_id;
            ELSE
                UPDATE public.produtos
                SET estoque = estoque + v_item.quantity
                WHERE id = v_item.product_id;
            END IF;
        END LOOP;
    END IF;

    -- Update status
    UPDATE public.marketplace_orders
    SET status = p_new_status, updated_at = NOW()
    WHERE id = p_order_id
    RETURNING to_jsonb(public.marketplace_orders.*) INTO v_result;

    -- Log history
    INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
    VALUES (p_order_id, v_old_status, p_new_status, p_notes, v_caller_id);

    RETURN v_result;
END;
$$;


--
-- Name: upsert_store_config("jsonb"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_store_config("config_json" "jsonb") RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  result jsonb;
  v_methods text[];
  v_has_methods boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;

  -- Handle text[] casting safely
  v_has_methods := config_json ? 'enabled_shipping_methods'
    AND config_json->'enabled_shipping_methods' IS NOT NULL
    AND jsonb_typeof(config_json->'enabled_shipping_methods') = 'array';

  IF v_has_methods THEN
    SELECT COALESCE(array_agg(x), '{}'::text[]) INTO v_methods
    FROM jsonb_array_elements_text(config_json->'enabled_shipping_methods') x;
  ELSE
    v_methods := '{sedex, pac}'::text[];
  END IF;

  INSERT INTO public.store_config (
    id, free_shipping_min, shipping_fee, whatsapp_number, share_text,
    business_hours, enable_reviews, enable_coupons, primary_color,
    theme_mode, logo_url, real_time_sales_alerts, push_marketing_enabled,
    min_app_version, origin_cep, shipping_provider, enabled_shipping_methods,
    shipping_coverage, local_delivery_fee, local_cep_range
  )
  VALUES (
    1,
    COALESCE((config_json->>'free_shipping_min')::numeric, 100),
    COALESCE((config_json->>'shipping_fee')::numeric, 15),
    COALESCE(config_json->>'whatsapp_number', '5534999999999'),
    COALESCE(config_json->>'share_text', 'Confira os produtos!'),
    COALESCE(config_json->>'business_hours', 'Seg-Sáb: 9h às 18h'),
    COALESCE((config_json->>'enable_reviews')::boolean, true),
    COALESCE((config_json->>'enable_coupons')::boolean, true),
    COALESCE(config_json->>'primary_color', '#000000'),
    COALESCE(config_json->>'theme_mode', 'light'),
    config_json->>'logo_url',
    COALESCE((config_json->>'real_time_sales_alerts')::boolean, true),
    COALESCE((config_json->>'push_marketing_enabled')::boolean, false),
    config_json->>'min_app_version',
    COALESCE(config_json->>'origin_cep', '38500-000'),
    COALESCE(config_json->>'shipping_provider', 'flat_fee'),
    v_methods,
    COALESCE(config_json->>'shipping_coverage', 'national'),
    COALESCE((config_json->>'local_delivery_fee')::numeric, 10.00),
    config_json->>'local_cep_range'
  )
  -- A partir daqui: só sobrescreve o que veio no payload. [ALTERADO]
  ON CONFLICT (id) DO UPDATE SET
    free_shipping_min = CASE WHEN config_json ? 'free_shipping_min'
      THEN (config_json->>'free_shipping_min')::numeric
      ELSE store_config.free_shipping_min END,
    shipping_fee = CASE WHEN config_json ? 'shipping_fee'
      THEN (config_json->>'shipping_fee')::numeric
      ELSE store_config.shipping_fee END,
    whatsapp_number = CASE WHEN config_json ? 'whatsapp_number'
      THEN config_json->>'whatsapp_number'
      ELSE store_config.whatsapp_number END,
    share_text = CASE WHEN config_json ? 'share_text'
      THEN config_json->>'share_text'
      ELSE store_config.share_text END,
    business_hours = CASE WHEN config_json ? 'business_hours'
      THEN config_json->>'business_hours'
      ELSE store_config.business_hours END,
    enable_reviews = CASE WHEN config_json ? 'enable_reviews'
      THEN (config_json->>'enable_reviews')::boolean
      ELSE store_config.enable_reviews END,
    enable_coupons = CASE WHEN config_json ? 'enable_coupons'
      THEN (config_json->>'enable_coupons')::boolean
      ELSE store_config.enable_coupons END,
    primary_color = CASE WHEN config_json ? 'primary_color'
      THEN config_json->>'primary_color'
      ELSE store_config.primary_color END,
    theme_mode = CASE WHEN config_json ? 'theme_mode'
      THEN config_json->>'theme_mode'
      ELSE store_config.theme_mode END,
    logo_url = CASE WHEN config_json ? 'logo_url'
      THEN config_json->>'logo_url'
      ELSE store_config.logo_url END,
    real_time_sales_alerts = CASE WHEN config_json ? 'real_time_sales_alerts'
      THEN (config_json->>'real_time_sales_alerts')::boolean
      ELSE store_config.real_time_sales_alerts END,
    push_marketing_enabled = CASE WHEN config_json ? 'push_marketing_enabled'
      THEN (config_json->>'push_marketing_enabled')::boolean
      ELSE store_config.push_marketing_enabled END,
    min_app_version = CASE WHEN config_json ? 'min_app_version'
      THEN config_json->>'min_app_version'
      ELSE store_config.min_app_version END,
    origin_cep = CASE WHEN config_json ? 'origin_cep'
      THEN config_json->>'origin_cep'
      ELSE store_config.origin_cep END,
    shipping_provider = CASE WHEN config_json ? 'shipping_provider'
      THEN config_json->>'shipping_provider'
      ELSE store_config.shipping_provider END,
    enabled_shipping_methods = CASE WHEN v_has_methods
      THEN v_methods
      ELSE store_config.enabled_shipping_methods END,
    shipping_coverage = CASE WHEN config_json ? 'shipping_coverage'
      THEN config_json->>'shipping_coverage'
      ELSE store_config.shipping_coverage END,
    local_delivery_fee = CASE WHEN config_json ? 'local_delivery_fee'
      THEN (config_json->>'local_delivery_fee')::numeric
      ELSE store_config.local_delivery_fee END,
    local_cep_range = CASE WHEN config_json ? 'local_cep_range'
      THEN config_json->>'local_cep_range'
      ELSE store_config.local_cep_range END,
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$$;


--
-- Name: validate_coupon_secure("text", numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_coupon_secure("p_code" "text", "p_subtotal" numeric) RETURNS TABLE("is_valid" boolean, "discount_amount" numeric, "discount_type" "text", "error_message" "text")
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_coupon RECORD;
BEGIN
    SELECT * INTO v_coupon FROM public.coupons 
    WHERE UPPER(code) = UPPER(p_code) AND active = true
    FOR SHARE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 0::NUMERIC, NULL::TEXT, 'Cupom inválido ou inexistente.'::TEXT;
        RETURN;
    END IF;

    IF v_coupon.valid_until IS NOT NULL AND v_coupon.valid_until < NOW() THEN
        RETURN QUERY SELECT false, 0::NUMERIC, v_coupon.type, 'Cupom expirado.'::TEXT;
        RETURN;
    END IF;

    IF v_coupon.usage_limit IS NOT NULL AND v_coupon.usage_count >= v_coupon.usage_limit THEN
        RETURN QUERY SELECT false, 0::NUMERIC, v_coupon.type, 'Limite de uso atingido.'::TEXT;
        RETURN;
    END IF;

    IF v_coupon.min_purchase IS NOT NULL AND p_subtotal < v_coupon.min_purchase THEN
        RETURN QUERY SELECT false, 0::NUMERIC, v_coupon.type, 'Valor mínimo não atingido.'::TEXT;
        RETURN;
    END IF;

    IF v_coupon.type = 'percentage' THEN
        RETURN QUERY SELECT true, (p_subtotal * v_coupon.value / 100.0), 'percentage'::TEXT, NULL::TEXT;
    ELSE
        RETURN QUERY SELECT true, LEAST(v_coupon.value, p_subtotal), 'fixed'::TEXT, NULL::TEXT;
    END IF;
END;
$$;


--
-- Name: validate_coupon_secure_v2("text", numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_coupon_secure_v2("p_code" "text", "p_subtotal" numeric) RETURNS "jsonb"
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


--
-- Name: _ninja_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._ninja_migrations (
    id integer NOT NULL,
    filename "text",
    applied_at timestamp with time zone DEFAULT "now"(),
    checksum "text"
);


--
-- Name: _ninja_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public._ninja_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _ninja_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public._ninja_migrations_id_seq OWNED BY public._ninja_migrations.id;


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    event_type "text" NOT NULL,
    product_id "text",
    source_view "text",
    user_id "uuid",
    metadata "jsonb" DEFAULT '{}'::"jsonb",
    created_at timestamp with time zone DEFAULT "now"()
);


--
-- Name: answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.answers (
    id "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    question_id "uuid" NOT NULL,
    user_id "uuid" NOT NULL,
    answer "text" NOT NULL,
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key "text" NOT NULL,
    value "text" NOT NULL,
    description "text",
    created_at timestamp with time zone DEFAULT "now"(),
    updated_at timestamp with time zone DEFAULT "now"()
);


--
-- Name: banners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.banners (
    id "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    image_url "text" NOT NULL,
    title "text",
    link "text",
    "position" "text" DEFAULT 'home_top'::"text",
    active boolean DEFAULT true,
    "order" integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT banners_position_check CHECK (("position" = ANY (ARRAY['home_top'::"text", 'home_middle'::"text", 'home_bottom'::"text"])))
);


--
-- Name: cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cart_items (
    id "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    user_id "uuid" NOT NULL,
    product_id "text" NOT NULL,
    variant_id "text" DEFAULT ''::"text" NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    updated_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    variant_names "text"
);


--
-- Name: categorias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categorias (
    id "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    nome "text" NOT NULL,
    slug "text",
    descricao "text",
    ativo boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    code "text" NOT NULL,
    type "text" NOT NULL,
    value numeric NOT NULL,
    min_purchase numeric DEFAULT 0,
    usage_limit integer,
    usage_count integer DEFAULT 0,
    valid_until timestamp with time zone,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    used_count integer DEFAULT 0,
    CONSTRAINT coupons_type_check CHECK (("type" = ANY (ARRAY['fixed'::"text", 'percentage'::"text"])))
);


--
-- Name: favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favorites (
    id "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    user_id "uuid" NOT NULL,
    product_id "text" NOT NULL,
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


--
-- Name: marketplace_ai_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_ai_state (
    component_name "text" NOT NULL,
    state_json "jsonb" NOT NULL,
    updated_at timestamp with time zone DEFAULT "now"()
);


--
-- Name: marketplace_order_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_order_history (
    id "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    order_id "uuid" NOT NULL,
    old_status "text",
    new_status "text" NOT NULL,
    notes "text",
    created_at timestamp with time zone DEFAULT "now"(),
    created_by "uuid"
);


--
-- Name: marketplace_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_order_items (
    id "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    order_id "uuid",
    product_id "uuid",
    product_name "text",
    quantity integer NOT NULL,
    price numeric(10,2) NOT NULL,
    image_url "text",
    created_at timestamp with time zone DEFAULT "now"(),
    variant_id "uuid",
    CONSTRAINT check_quantity_positive CHECK (("quantity" > 0))
);


--
-- Name: marketplace_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_orders (
    id "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    customer_name "text" NOT NULL,
    customer_data "jsonb" NOT NULL,
    status "text",
    total numeric(10,2) NOT NULL,
    subtotal numeric(10,2) NOT NULL,
    shipping numeric(10,2) DEFAULT 0,
    discount numeric(10,2) DEFAULT 0,
    payment_method "text",
    coupon_code "text",
    notes "text",
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    updated_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    user_id "uuid",
    tracking_code "text",
    address_id "uuid",
    coupon_id "uuid",
    customer_phone "text",
    total_amount numeric,
    shipping_cost numeric,
    observation "text",
    CONSTRAINT check_total_positive CHECK (("total" >= (0)::numeric)),
    CONSTRAINT marketplace_orders_status_check CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'shipping'::"text", 'delivered'::"text", 'cancelled'::"text", 'new'::"text"])))
);

ALTER TABLE ONLY public.marketplace_orders REPLICA IDENTITY FULL;


--
-- Name: notificacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notificacoes (
    id "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    usuario_id "uuid",
    tipo "text",
    titulo "text" NOT NULL,
    mensagem "text",
    dados "jsonb" DEFAULT '{}'::"jsonb",
    lida boolean DEFAULT false,
    acao "jsonb" DEFAULT '{}'::"jsonb",
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT notificacoes_tipo_check CHECK (("tipo" = ANY (ARRAY['info'::"text", 'warning'::"text", 'error'::"text", 'success'::"text", 'sistema'::"text", 'pedido_novo'::"text", 'estoque_baixo'::"text", 'pagamento'::"text", 'venda'::"text", 'aviso'::"text", 'sucesso'::"text", 'erro'::"text"])))
);

ALTER TABLE ONLY public.notificacoes REPLICA IDENTITY FULL;


--
-- Name: otp_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_verifications (
    id "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    email "text" NOT NULL,
    whatsapp "text" NOT NULL,
    otp_code "text" NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT "now"(),
    order_id "uuid" NOT NULL,
    attempts integer DEFAULT 0 NOT NULL
);


--
-- Name: COLUMN otp_verifications.order_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.otp_verifications.order_id IS 'Pedido ao qual este código dá acesso. Antes da AUTH-010 (#118) o código abria todos os pedidos que casassem com o e-mail OU o WhatsApp.';


--
-- Name: COLUMN otp_verifications.attempts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.otp_verifications.attempts IS 'Tentativas erradas. Em 5, o código morre. Incrementado no caminho de falha, que RETORNA em vez de RAISE: no PostgREST o RAISE reverteria o incremento.';


--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    product_id "uuid" NOT NULL,
    sku "text",
    name "text" NOT NULL,
    value "text" NOT NULL,
    stock_increment integer DEFAULT 0,
    price_override numeric,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    image_url "text",
    CONSTRAINT check_stock_increment_positivo CHECK (("stock_increment" >= 0))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id "uuid" NOT NULL,
    full_name "text",
    avatar_url "text",
    role "text" DEFAULT 'vendedor'::"text",
    company_id "uuid",
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    updated_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    whatsapp "text",
    cpf "text",
    cover_url "text",
    CONSTRAINT profiles_role_check CHECK (("role" = ANY (ARRAY['admin'::"text", 'gerente'::"text", 'vendedor'::"text", 'customer'::"text"])))
);


--
-- Name: public_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_profiles (
    id "uuid" NOT NULL,
    full_name "text",
    avatar_url "text",
    created_at timestamp with time zone,
    cover_url "text"
);


--
-- Name: push_notifications_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_notifications_log (
    id "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    title "text" NOT NULL,
    body "text" NOT NULL,
    url "text" DEFAULT '/'::"text",
    sent_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    status "text" DEFAULT 'sent'::"text",
    recipient_count integer DEFAULT 0,
    created_by "uuid"
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    endpoint "text" NOT NULL,
    p256dh "text" NOT NULL,
    auth "text" NOT NULL,
    user_id "uuid",
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


--
-- Name: questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questions (
    id "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    product_id "uuid" NOT NULL,
    user_id "uuid" NOT NULL,
    question "text" NOT NULL,
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    product_id "uuid" NOT NULL,
    user_id "uuid" NOT NULL,
    rating integer NOT NULL,
    comment "text",
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    helpful integer DEFAULT 0,
    verified boolean DEFAULT false,
    merchant_reply "text",
    merchant_reply_at timestamp with time zone,
    CONSTRAINT reviews_rating_check CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


--
-- Name: sales_overview; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.sales_overview WITH (security_invoker='on') AS
 SELECT (("created_at" AT TIME ZONE 'UTC'::"text"))::"date" AS "sales_day",
    "count"("id") AS "total_orders",
    "sum"("total") AS "gross_revenue",
    "avg"("total") AS "average_ticket",
    "sum"(
        CASE
            WHEN ("status" = 'completed'::"text") THEN "total"
            ELSE (0)::numeric
        END) AS "net_revenue"
   FROM "public"."marketplace_orders"
  GROUP BY ((("created_at" AT TIME ZONE 'UTC'::"text"))::"date")
  ORDER BY ((("created_at" AT TIME ZONE 'UTC'::"text"))::"date") DESC;


--
-- Name: shipping_calculation_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_calculation_logs (
    id bigint NOT NULL,
    origin_cep "text" NOT NULL,
    destination_cep "text" NOT NULL,
    provider "text" NOT NULL,
    cart_items "jsonb" NOT NULL,
    response_time_ms integer NOT NULL,
    status "text" NOT NULL,
    error_message "text",
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


--
-- Name: shipping_calculation_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.shipping_calculation_logs ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.shipping_calculation_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: shipping_quotes_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_quotes_cache (
    id "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    origin_cep "text" NOT NULL,
    destination_cep "text" NOT NULL,
    cart_hash "text" NOT NULL,
    options "jsonb" NOT NULL,
    created_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


--
-- Name: store_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_config (
    id bigint NOT NULL,
    free_shipping_min numeric(10,2) DEFAULT 100,
    shipping_fee numeric(10,2) DEFAULT 15,
    whatsapp_number "text" DEFAULT '5534999999999'::"text",
    share_text "text" DEFAULT 'Confira os produtos da Ikous!'::"text",
    business_hours "text" DEFAULT 'Seg-Sáb: 9h às 18h'::"text",
    enable_reviews boolean DEFAULT true,
    enable_coupons boolean DEFAULT true,
    primary_color "text" DEFAULT '#000000'::"text",
    theme_mode "text" DEFAULT 'light'::"text",
    logo_url "text",
    real_time_sales_alerts boolean DEFAULT true,
    push_marketing_enabled boolean DEFAULT false,
    min_app_version "text",
    created_at timestamp with time zone DEFAULT "now"(),
    updated_at timestamp with time zone DEFAULT "now"(),
    origin_cep "text" DEFAULT '38500-000'::"text",
    shipping_provider "text" DEFAULT 'flat_fee'::"text" NOT NULL,
    enabled_shipping_methods "text"[] DEFAULT '{sedex,pac}'::"text"[],
    shipping_coverage "text" DEFAULT 'national'::"text" NOT NULL,
    local_delivery_fee numeric DEFAULT 10.00 NOT NULL,
    local_cep_range "text",
    CONSTRAINT store_config_shipping_coverage_check CHECK (("shipping_coverage" = ANY (ARRAY['local'::"text", 'national'::"text"])))
);


--
-- Name: store_shipping_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_shipping_credentials (
    provider "text" NOT NULL,
    credentials "jsonb" NOT NULL,
    updated_at timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


--
-- Name: user_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_addresses (
    id "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    user_id "uuid" NOT NULL,
    name "text" NOT NULL,
    recipient_name "text" NOT NULL,
    cep "text" NOT NULL,
    street "text" NOT NULL,
    number "text" NOT NULL,
    complement "text",
    neighborhood "text" NOT NULL,
    city "text" NOT NULL,
    state "text" NOT NULL,
    reference "text",
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT "now"(),
    updated_at timestamp with time zone DEFAULT "now"()
);


--
-- Name: v_store_config; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_store_config WITH (security_invoker='on') AS
 SELECT "id",
    "free_shipping_min",
    "shipping_fee",
    "whatsapp_number",
    "share_text",
    "business_hours",
    "enable_reviews",
    "enable_coupons",
    "primary_color",
    "theme_mode",
    "logo_url",
    "real_time_sales_alerts",
    "push_marketing_enabled",
    "min_app_version",
    "origin_cep",
    "shipping_provider",
    "enabled_shipping_methods",
    "shipping_coverage",
    "local_delivery_fee",
    "local_cep_range",
    "created_at",
    "updated_at"
   FROM "public"."store_config"
  WHERE ("id" = 1);


--
-- Name: vor_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vor_receipts (
    id "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    action_type "text" NOT NULL,
    input_data "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    output_data "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    proof_hash "text" NOT NULL,
    previous_hash "text",
    verified boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT "now"()
);


--
-- Name: vw_produtos_admin; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_produtos_admin AS
 SELECT "id",
    "nome",
    "descricao",
    "categoria",
    "codigo",
    "custo",
    "preco_venda",
    "estoque",
    "estoque_minimo",
    "fornecedor_id",
    "ativo",
    "tags",
    "data_cadastro",
    "ultima_atualizacao",
    "imagem_url",
    "meta_title",
    "meta_description",
    "imagem_urls",
    "preco_original",
    "is_bestseller",
    "frete_gratis",
    "sold",
    "deleted_at",
    "calculated_points",
    "rating",
    "review_count",
    "peso_kg",
    "largura_cm",
    "altura_cm",
    "comprimento_cm"
   FROM "public"."produtos"
  WHERE "public"."is_admin"()
  WITH CASCADED CHECK OPTION;


--
-- Name: VIEW vw_produtos_admin; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.vw_produtos_admin IS 'Porta do admin para produtos, custo incluso. Guardada por is_admin() no WHERE, não por GRANT: no Supabase o admin é o mesmo papel authenticated do cliente. Recriada em 05/08/2026 (BANCO-010, #119) — existia, sumiu do banco sem deixar migration, e o cadastro de produto ficou quebrado.';


--
-- Name: vw_produtos_public; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_produtos_public AS
 SELECT "id",
    "nome",
    "descricao",
    "preco_venda",
    "preco_original",
    "estoque",
    "imagem_url",
    "imagem_urls",
    "categoria",
    "ativo",
    "data_cadastro",
    "tags",
    "meta_title",
    "meta_description",
    "is_bestseller",
    "frete_gratis",
    "sold",
    "calculated_points",
    "codigo",
    "ultima_atualizacao",
    "rating",
    "review_count",
    "peso_kg",
    "largura_cm",
    "altura_cm",
    "comprimento_cm"
   FROM "public"."produtos"
  WHERE (("ativo" = true) AND ("deleted_at" IS NULL));


--
-- Name: vw_questions_with_answers_count; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_questions_with_answers_count WITH (security_invoker='on') AS
 SELECT "id",
    "product_id",
    "user_id",
    "question",
    "created_at",
    COALESCE(( SELECT ("count"(*))::integer AS "count"
           FROM "public"."answers" "a"
          WHERE ("a"."question_id" = "q"."id")), 0) AS "answers_count"
   FROM "public"."questions" "q";


--
-- Name: _ninja_migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._ninja_migrations ALTER COLUMN id SET DEFAULT "nextval"('"public"."_ninja_migrations_id_seq"'::"regclass");


--
-- Name: _ninja_migrations _ninja_migrations_filename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._ninja_migrations
    ADD CONSTRAINT _ninja_migrations_filename_key UNIQUE (filename);


--
-- Name: _ninja_migrations _ninja_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._ninja_migrations
    ADD CONSTRAINT _ninja_migrations_pkey PRIMARY KEY (id);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: answers answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answers
    ADD CONSTRAINT answers_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: banners banners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.banners
    ADD CONSTRAINT banners_pkey PRIMARY KEY (id);


--
-- Name: cart_items cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_pkey PRIMARY KEY (id);


--
-- Name: cart_items cart_items_user_id_product_id_variant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_user_id_product_id_variant_id_key UNIQUE (user_id, product_id, variant_id);


--
-- Name: categorias categorias_nome_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_nome_key UNIQUE (nome);


--
-- Name: categorias categorias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_pkey PRIMARY KEY (id);


--
-- Name: categorias categorias_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_slug_key UNIQUE (slug);


--
-- Name: coupons coupons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_key UNIQUE (code);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_user_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_product_id_key UNIQUE (user_id, product_id);


--
-- Name: marketplace_ai_state marketplace_ai_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_ai_state
    ADD CONSTRAINT marketplace_ai_state_pkey PRIMARY KEY (component_name);


--
-- Name: marketplace_order_history marketplace_order_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_order_history
    ADD CONSTRAINT marketplace_order_history_pkey PRIMARY KEY (id);


--
-- Name: marketplace_order_items marketplace_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_order_items
    ADD CONSTRAINT marketplace_order_items_pkey PRIMARY KEY (id);


--
-- Name: marketplace_orders marketplace_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_orders
    ADD CONSTRAINT marketplace_orders_pkey PRIMARY KEY (id);


--
-- Name: notificacoes notificacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notificacoes
    ADD CONSTRAINT notificacoes_pkey PRIMARY KEY (id);


--
-- Name: otp_verifications otp_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_verifications
    ADD CONSTRAINT otp_verifications_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_sku_key UNIQUE (sku);


--
-- Name: produtos produtos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: public_profiles public_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_profiles
    ADD CONSTRAINT public_profiles_pkey PRIMARY KEY (id);


--
-- Name: push_notifications_log push_notifications_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_notifications_log
    ADD CONSTRAINT push_notifications_log_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: questions questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: shipping_calculation_logs shipping_calculation_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_calculation_logs
    ADD CONSTRAINT shipping_calculation_logs_pkey PRIMARY KEY (id);


--
-- Name: shipping_quotes_cache shipping_quotes_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_quotes_cache
    ADD CONSTRAINT shipping_quotes_cache_pkey PRIMARY KEY (id);


--
-- Name: store_config store_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_config
    ADD CONSTRAINT store_config_pkey PRIMARY KEY (id);


--
-- Name: store_shipping_credentials store_shipping_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_shipping_credentials
    ADD CONSTRAINT store_shipping_credentials_pkey PRIMARY KEY (provider);


--
-- Name: user_addresses user_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT user_addresses_pkey PRIMARY KEY (id);


--
-- Name: vor_receipts vor_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vor_receipts
    ADD CONSTRAINT vor_receipts_pkey PRIMARY KEY (id);


--
-- Name: favorites_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "favorites_user_id_idx" ON "public"."favorites" USING "btree" ("user_id");


--
-- Name: idx_analytics_events_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_analytics_events_user_id" ON "public"."analytics_events" USING "btree" ("user_id");


--
-- Name: idx_answers_question_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_answers_question_id" ON "public"."answers" USING "btree" ("question_id");


--
-- Name: idx_answers_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_answers_user_id" ON "public"."answers" USING "btree" ("user_id");


--
-- Name: idx_coupons_active_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_coupons_active_code" ON "public"."coupons" USING "btree" ("active", "code");


--
-- Name: idx_marketplace_order_history_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_marketplace_order_history_created_by" ON "public"."marketplace_order_history" USING "btree" ("created_by");


--
-- Name: idx_marketplace_order_history_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_marketplace_order_history_order_id" ON "public"."marketplace_order_history" USING "btree" ("order_id");


--
-- Name: idx_marketplace_order_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_marketplace_order_items_order_id" ON "public"."marketplace_order_items" USING "btree" ("order_id");


--
-- Name: idx_marketplace_order_items_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_marketplace_order_items_product_id" ON "public"."marketplace_order_items" USING "btree" ("product_id");


--
-- Name: idx_marketplace_order_items_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_marketplace_order_items_variant_id" ON "public"."marketplace_order_items" USING "btree" ("variant_id");


--
-- Name: idx_marketplace_orders_address_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_marketplace_orders_address_id" ON "public"."marketplace_orders" USING "btree" ("address_id");


--
-- Name: idx_marketplace_orders_coupon_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_marketplace_orders_coupon_id" ON "public"."marketplace_orders" USING "btree" ("coupon_id");


--
-- Name: idx_marketplace_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_marketplace_orders_created_at" ON "public"."marketplace_orders" USING "btree" ("created_at" DESC);


--
-- Name: idx_marketplace_orders_created_at_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_marketplace_orders_created_at_date" ON "public"."marketplace_orders" USING "btree" (((("created_at" AT TIME ZONE 'UTC'::"text"))::"date"));


--
-- Name: idx_marketplace_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_marketplace_orders_status" ON "public"."marketplace_orders" USING "btree" ("status");


--
-- Name: idx_marketplace_orders_user_role_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_marketplace_orders_user_role_lookup" ON "public"."marketplace_orders" USING "btree" ("user_id");


--
-- Name: idx_otp_verifications_email_pendente; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_otp_verifications_email_pendente" ON "public"."otp_verifications" USING "btree" ("email", "expires_at" DESC) WHERE ("verified" = false);


--
-- Name: idx_otp_verifications_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_otp_verifications_expires_at" ON "public"."otp_verifications" USING "btree" ("expires_at");


--
-- Name: idx_product_variants_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_product_variants_product_id" ON "public"."product_variants" USING "btree" ("product_id");


--
-- Name: idx_produtos_ativo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_produtos_ativo" ON "public"."produtos" USING "btree" ("ativo");


--
-- Name: idx_produtos_categoria; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_produtos_categoria" ON "public"."produtos" USING "btree" ("categoria");


--
-- Name: idx_profiles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_profiles_role" ON "public"."profiles" USING "btree" ("role");


--
-- Name: idx_push_log_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_push_log_sent_at" ON "public"."push_notifications_log" USING "btree" ("sent_at" DESC);


--
-- Name: idx_push_notifications_log_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_push_notifications_log_created_by" ON "public"."push_notifications_log" USING "btree" ("created_by");


--
-- Name: idx_push_subscriptions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_push_subscriptions_user_id" ON "public"."push_subscriptions" USING "btree" ("user_id");


--
-- Name: idx_questions_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_questions_product_id" ON "public"."questions" USING "btree" ("product_id");


--
-- Name: idx_questions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_questions_user_id" ON "public"."questions" USING "btree" ("user_id");


--
-- Name: idx_reviews_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_reviews_product_id" ON "public"."reviews" USING "btree" ("product_id");


--
-- Name: idx_reviews_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_reviews_user_id" ON "public"."reviews" USING "btree" ("user_id");


--
-- Name: idx_shipping_calculation_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_shipping_calculation_logs_created_at" ON "public"."shipping_calculation_logs" USING "btree" ("created_at" DESC);


--
-- Name: idx_shipping_quotes_cache_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_shipping_quotes_cache_created_at" ON "public"."shipping_quotes_cache" USING "btree" ("created_at");


--
-- Name: idx_shipping_quotes_cache_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_shipping_quotes_cache_lookup" ON "public"."shipping_quotes_cache" USING "btree" ("origin_cep", "destination_cep", "cart_hash");


--
-- Name: idx_shipping_quotes_cache_recentes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_shipping_quotes_cache_recentes" ON "public"."shipping_quotes_cache" USING "btree" ("destination_cep", "created_at" DESC);


--
-- Name: idx_user_addresses_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_user_addresses_user_id" ON "public"."user_addresses" USING "btree" ("user_id");


--
-- Name: idx_vor_receipts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "idx_vor_receipts_created_at" ON "public"."vor_receipts" USING "btree" ("created_at" DESC);


--
-- Name: user_addresses on_address_default_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "on_address_default_update" BEFORE INSERT OR UPDATE ON "public"."user_addresses" FOR EACH ROW EXECUTE FUNCTION "public"."handle_default_address"();


--
-- Name: otp_verifications on_otp_created_send_email; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "on_otp_created_send_email" AFTER INSERT ON "public"."otp_verifications" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_otp_verification"();


--
-- Name: cart_items set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."cart_items" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();


--
-- Name: profiles sync_public_profile; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "sync_public_profile" AFTER INSERT OR DELETE OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."handle_public_profile_sync"();


--
-- Name: profiles tr_ensure_role_protection; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "tr_ensure_role_protection" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_role_protection"();


--
-- Name: profiles tr_prevent_role_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "tr_prevent_role_change" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_role_change"();


--
-- Name: profiles tr_sync_profile_role_to_auth; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "tr_sync_profile_role_to_auth" AFTER INSERT OR UPDATE OF "role" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."handle_profile_role_sync_to_auth"();


--
-- Name: shipping_quotes_cache trigger_clean_expired_shipping_quotes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trigger_clean_expired_shipping_quotes" AFTER INSERT ON "public"."shipping_quotes_cache" FOR EACH STATEMENT EXECUTE FUNCTION "public"."clean_expired_shipping_quotes"();


--
-- Name: shipping_calculation_logs trigger_clean_old_shipping_logs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "trigger_clean_old_shipping_logs" AFTER INSERT ON "public"."shipping_calculation_logs" FOR EACH STATEMENT EXECUTE FUNCTION "public"."clean_old_shipping_logs"();


--
-- Name: analytics_events analytics_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_user_id_fkey FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");


--
-- Name: answers answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answers
    ADD CONSTRAINT answers_question_id_fkey FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE CASCADE;


--
-- Name: answers answers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answers
    ADD CONSTRAINT answers_user_id_fkey FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: cart_items cart_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_user_id_fkey FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: favorites favorites_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_user_id_fkey FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");


--
-- Name: answers fk_answers_user_public_profiles; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.answers
    ADD CONSTRAINT fk_answers_user_public_profiles FOREIGN KEY ("user_id") REFERENCES "public"."public_profiles"("id") ON DELETE SET NULL;


--
-- Name: marketplace_orders fk_marketplace_orders_address; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_orders
    ADD CONSTRAINT fk_marketplace_orders_address FOREIGN KEY ("address_id") REFERENCES "public"."user_addresses"("id") ON DELETE SET NULL;


--
-- Name: questions fk_questions_user_public_profiles; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT fk_questions_user_public_profiles FOREIGN KEY ("user_id") REFERENCES "public"."public_profiles"("id") ON DELETE SET NULL;


--
-- Name: reviews fk_reviews_user_public_profiles; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT fk_reviews_user_public_profiles FOREIGN KEY ("user_id") REFERENCES "public"."public_profiles"("id") ON DELETE SET NULL;


--
-- Name: marketplace_order_history marketplace_order_history_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_order_history
    ADD CONSTRAINT marketplace_order_history_created_by_fkey FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");


--
-- Name: marketplace_order_history marketplace_order_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_order_history
    ADD CONSTRAINT marketplace_order_history_order_id_fkey FOREIGN KEY ("order_id") REFERENCES "public"."marketplace_orders"("id") ON DELETE CASCADE;


--
-- Name: marketplace_order_items marketplace_order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_order_items
    ADD CONSTRAINT marketplace_order_items_order_id_fkey FOREIGN KEY ("order_id") REFERENCES "public"."marketplace_orders"("id") ON DELETE CASCADE;


--
-- Name: marketplace_order_items marketplace_order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_order_items
    ADD CONSTRAINT marketplace_order_items_product_id_fkey FOREIGN KEY ("product_id") REFERENCES "public"."produtos"("id");


--
-- Name: marketplace_order_items marketplace_order_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_order_items
    ADD CONSTRAINT marketplace_order_items_variant_id_fkey FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id");


--
-- Name: marketplace_orders marketplace_orders_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_orders
    ADD CONSTRAINT marketplace_orders_coupon_id_fkey FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id");


--
-- Name: marketplace_orders marketplace_orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_orders
    ADD CONSTRAINT marketplace_orders_user_id_fkey FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");


--
-- Name: otp_verifications otp_verifications_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_verifications
    ADD CONSTRAINT otp_verifications_order_id_fkey FOREIGN KEY ("order_id") REFERENCES "public"."marketplace_orders"("id") ON DELETE CASCADE;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY ("product_id") REFERENCES "public"."produtos"("id") ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: public_profiles public_profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_profiles
    ADD CONSTRAINT public_profiles_id_fkey FOREIGN KEY ("id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


--
-- Name: push_notifications_log push_notifications_log_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_notifications_log
    ADD CONSTRAINT push_notifications_log_created_by_fkey FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");


--
-- Name: questions questions_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_product_id_fkey FOREIGN KEY ("product_id") REFERENCES "public"."produtos"("id") ON DELETE CASCADE;


--
-- Name: questions questions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_user_id_fkey FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: reviews reviews_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_product_id_fkey FOREIGN KEY ("product_id") REFERENCES "public"."produtos"("id") ON DELETE CASCADE;


--
-- Name: reviews reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_user_id_fkey FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: user_addresses user_addresses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT user_addresses_user_id_fkey FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");


--
-- Name: vor_receipts Admins can view all VOR receipts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all VOR receipts" ON public.vor_receipts FOR SELECT TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: _ninja_migrations Admins full access on _ninja_migrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins full access on _ninja_migrations" ON public._ninja_migrations TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: otp_verifications Admins full access on otp_verifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins full access on otp_verifications" ON public.otp_verifications TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: shipping_calculation_logs Admins have full access to shipping calculation logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to shipping calculation logs" ON public.shipping_calculation_logs TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: store_shipping_credentials Admins have full access to shipping credentials; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to shipping credentials" ON public.store_shipping_credentials TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: shipping_quotes_cache Admins have full access to shipping_quotes_cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to shipping_quotes_cache" ON public.shipping_quotes_cache TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: app_settings Admins legacy access on app_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins legacy access on app_settings" ON public.app_settings TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: _ninja_migrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public._ninja_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_events analytics_events_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY analytics_events_insert_policy ON public.analytics_events FOR INSERT WITH CHECK ((((( SELECT "auth"."uid"() AS "uid") IS NULL) AND ("user_id" IS NULL)) OR (( SELECT "auth"."uid"() AS "uid") = "user_id")));


--
-- Name: analytics_events analytics_events_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY analytics_events_select_policy ON public.analytics_events FOR SELECT TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: answers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;

--
-- Name: answers answers_admin_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY answers_admin_delete_policy ON public.answers FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: answers answers_admin_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY answers_admin_insert_policy ON public.answers FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: answers answers_admin_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY answers_admin_update_policy ON public.answers FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: answers answers_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY answers_select_policy ON public.answers FOR SELECT USING (true);


--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: banners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

--
-- Name: banners banners_admin_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY banners_admin_delete_policy ON public.banners FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: banners banners_admin_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY banners_admin_insert_policy ON public.banners FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: banners banners_admin_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY banners_admin_update_policy ON public.banners FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: banners banners_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY banners_select_policy ON public.banners FOR SELECT USING ((("active" = true) OR ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text") AND ( SELECT "public"."is_admin"() AS "is_admin"))));


--
-- Name: cart_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

--
-- Name: cart_items cart_items_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cart_items_delete_policy ON public.cart_items FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));


--
-- Name: cart_items cart_items_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cart_items_insert_policy ON public.cart_items FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));


--
-- Name: cart_items cart_items_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cart_items_select_policy ON public.cart_items FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR ( SELECT "public"."is_admin"() AS "is_admin")));


--
-- Name: cart_items cart_items_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cart_items_update_policy ON public.cart_items FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));


--
-- Name: categorias; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;

--
-- Name: categorias categorias_admin_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categorias_admin_delete_policy ON public.categorias FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: categorias categorias_admin_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categorias_admin_insert_policy ON public.categorias FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: categorias categorias_admin_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categorias_admin_update_policy ON public.categorias FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: categorias categorias_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categorias_select_policy ON public.categorias FOR SELECT USING (true);


--
-- Name: coupons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

--
-- Name: coupons coupons_admin_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY coupons_admin_delete_policy ON public.coupons FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: coupons coupons_admin_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY coupons_admin_insert_policy ON public.coupons FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: coupons coupons_admin_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY coupons_admin_update_policy ON public.coupons FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: coupons coupons_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY coupons_select_policy ON public.coupons FOR SELECT USING ((("active" = true) OR ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text") AND ( SELECT "public"."is_admin"() AS "is_admin"))));


--
-- Name: favorites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

--
-- Name: favorites favorites_all_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY favorites_all_policy ON public.favorites TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));


--
-- Name: marketplace_ai_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_ai_state ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_ai_state marketplace_ai_state_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketplace_ai_state_admin_delete ON public.marketplace_ai_state FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: marketplace_ai_state marketplace_ai_state_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketplace_ai_state_admin_insert ON public.marketplace_ai_state FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: marketplace_ai_state marketplace_ai_state_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketplace_ai_state_admin_select ON public.marketplace_ai_state FOR SELECT TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: marketplace_ai_state marketplace_ai_state_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketplace_ai_state_admin_update ON public.marketplace_ai_state FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: marketplace_order_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_order_history ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_orders marketplace_orders_admin_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketplace_orders_admin_delete_policy ON public.marketplace_orders FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: marketplace_orders marketplace_orders_admin_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketplace_orders_admin_insert_policy ON public.marketplace_orders FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: marketplace_orders marketplace_orders_admin_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketplace_orders_admin_update_policy ON public.marketplace_orders FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: marketplace_orders marketplace_orders_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketplace_orders_select_policy ON public.marketplace_orders FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR ( SELECT "public"."is_admin"() AS "is_admin")));


--
-- Name: notificacoes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

--
-- Name: notificacoes notificacoes_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notificacoes_delete_policy ON public.notificacoes FOR DELETE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "usuario_id") OR ( SELECT "public"."is_admin"() AS "is_admin")));


--
-- Name: notificacoes notificacoes_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notificacoes_insert_policy ON public.notificacoes FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "usuario_id") OR ( SELECT "public"."is_admin"() AS "is_admin")));


--
-- Name: notificacoes notificacoes_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notificacoes_select_policy ON public.notificacoes FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "usuario_id") OR ("usuario_id" IS NULL) OR ( SELECT "public"."is_admin"() AS "is_admin")));


--
-- Name: notificacoes notificacoes_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notificacoes_update_policy ON public.notificacoes FOR UPDATE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "usuario_id") OR ( SELECT "public"."is_admin"() AS "is_admin"))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "usuario_id") OR ( SELECT "public"."is_admin"() AS "is_admin")));


--
-- Name: marketplace_order_history order_history_all_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_history_all_policy ON public.marketplace_order_history TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."marketplace_orders" "mo"
  WHERE (("mo"."id" = "marketplace_order_history"."order_id") AND ("mo"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))))) WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."marketplace_orders" "mo"
  WHERE (("mo"."id" = "marketplace_order_history"."order_id") AND ("mo"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));


--
-- Name: marketplace_order_items order_items_all_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_items_all_policy ON public.marketplace_order_items TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."marketplace_orders" "mo"
  WHERE (("mo"."id" = "marketplace_order_items"."order_id") AND ("mo"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))))) WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."marketplace_orders" "mo"
  WHERE (("mo"."id" = "marketplace_order_items"."order_id") AND ("mo"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));


--
-- Name: otp_verifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.otp_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: product_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: product_variants product_variants_admin_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_variants_admin_delete_policy ON public.product_variants FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: product_variants product_variants_admin_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_variants_admin_insert_policy ON public.product_variants FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: product_variants product_variants_admin_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_variants_admin_update_policy ON public.product_variants FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: product_variants product_variants_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_variants_select_policy ON public.product_variants FOR SELECT USING (true);


--
-- Name: produtos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;

--
-- Name: produtos produtos_admin_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY produtos_admin_delete_policy ON public.produtos FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: produtos produtos_admin_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY produtos_admin_insert_policy ON public.produtos FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: produtos produtos_admin_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY produtos_admin_update_policy ON public.produtos FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: produtos produtos_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY produtos_select_policy ON public.produtos FOR SELECT USING ((("ativo" = true) OR ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text") AND ( SELECT "public"."is_admin"() AS "is_admin"))));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_policy ON public.profiles FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "id") OR ( SELECT "public"."is_admin"() AS "is_admin")));


--
-- Name: profiles profiles_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_policy ON public.profiles FOR UPDATE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "id") OR ( SELECT "public"."is_admin"() AS "is_admin"))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "id") OR ( SELECT "public"."is_admin"() AS "is_admin")));


--
-- Name: public_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: public_profiles public_profiles_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_profiles_select_policy ON public.public_profiles FOR SELECT USING (true);


--
-- Name: push_notifications_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_notifications_log ENABLE ROW LEVEL SECURITY;

--
-- Name: push_notifications_log push_notifications_log_admin_all_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_notifications_log_admin_all_policy ON public.push_notifications_log TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subscriptions_all_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_all_policy ON public.push_subscriptions TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR ( SELECT "public"."is_admin"() AS "is_admin"))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR ( SELECT "public"."is_admin"() AS "is_admin")));


--
-- Name: questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

--
-- Name: questions questions_admin_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY questions_admin_delete_policy ON public.questions FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: questions questions_admin_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY questions_admin_update_policy ON public.questions FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: questions questions_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY questions_insert_policy ON public.questions FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") IS NOT NULL));


--
-- Name: questions questions_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY questions_select_policy ON public.questions FOR SELECT USING (true);


--
-- Name: reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: reviews reviews_admin_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reviews_admin_delete_policy ON public.reviews FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: reviews reviews_admin_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reviews_admin_update_policy ON public.reviews FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: reviews reviews_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reviews_insert_policy ON public.reviews FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));


--
-- Name: reviews reviews_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reviews_select_policy ON public.reviews FOR SELECT USING (true);


--
-- Name: shipping_calculation_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipping_calculation_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_quotes_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipping_quotes_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: store_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_config ENABLE ROW LEVEL SECURITY;

--
-- Name: store_config store_config_admin_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY store_config_admin_delete_policy ON public.store_config FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: store_config store_config_admin_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY store_config_admin_insert_policy ON public.store_config FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: store_config store_config_admin_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY store_config_admin_update_policy ON public.store_config FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- Name: store_config store_config_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY store_config_select_policy ON public.store_config FOR SELECT USING (true);


--
-- Name: store_shipping_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_shipping_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: user_addresses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;

--
-- Name: user_addresses user_addresses_all_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_addresses_all_policy ON public.user_addresses TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR ( SELECT "public"."is_admin"() AS "is_admin"))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR ( SELECT "public"."is_admin"() AS "is_admin")));


--
-- Name: vor_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vor_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: vor_receipts vor_receipts_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vor_receipts_insert_policy ON public.vor_receipts FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));


--
-- PostgreSQL database dump complete
--

\unrestrict ZEJ03sZ5WLRTbXXkN9Eq1IHGArmg5qA5xBCSHuCVHfKjVNDSrifAn6UtMnM4Ppv

