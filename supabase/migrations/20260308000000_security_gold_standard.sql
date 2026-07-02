-- 1. Garantir que a função is_admin() seja SECURITY DEFINER e inexpugnável
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$;

-- 2. Blindagem da RPC upsert_store_config
CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- CHECK: Apenas admins podem alterar configurações
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: Apenas administradores podem alterar as configurações da loja.';
  END IF;

  INSERT INTO public.store_config (
    id,
    free_shipping_min,
    shipping_fee,
    whatsapp_number,
    share_text,
    business_hours,
    enable_reviews,
    enable_coupons,
    primary_color,
    theme_mode,
    logo_url,
    real_time_sales_alerts,
    push_marketing_enabled,
    min_app_version
  )
  VALUES (
    1,
    COALESCE((config_json->>'free_shipping_min')::numeric, 100),
    COALESCE((config_json->>'shipping_fee')::numeric, 15),
    COALESCE(config_json->>'whatsapp_number', '5534999999999'),
    COALESCE(config_json->>'share_text', 'Confira os produtos da Ikous!'),
    COALESCE(config_json->>'business_hours', 'Seg-Sáb: 9h às 18h'),
    COALESCE((config_json->>'enable_reviews')::boolean, true),
    COALESCE((config_json->>'enable_coupons')::boolean, true),
    COALESCE(config_json->>'primary_color', '#000000'),
    COALESCE(config_json->>'theme_mode', 'light'),
    config_json->>'logo_url',
    COALESCE((config_json->>'real_time_sales_alerts')::boolean, true),
    COALESCE((config_json->>'push_marketing_enabled')::boolean, false),
    config_json->>'min_app_version'
  )
  ON CONFLICT (id) DO UPDATE SET
    free_shipping_min = EXCLUDED.free_shipping_min,
    shipping_fee = EXCLUDED.shipping_fee,
    whatsapp_number = EXCLUDED.whatsapp_number,
    share_text = EXCLUDED.share_text,
    business_hours = EXCLUDED.business_hours,
    enable_reviews = EXCLUDED.enable_reviews,
    enable_coupons = EXCLUDED.enable_coupons,
    primary_color = EXCLUDED.primary_color,
    theme_mode = EXCLUDED.theme_mode,
    logo_url = EXCLUDED.logo_url,
    real_time_sales_alerts = EXCLUDED.real_time_sales_alerts,
    push_marketing_enabled = EXCLUDED.push_marketing_enabled,
    min_app_version = EXCLUDED.min_app_version,
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$$;

-- 3. Blindagem da RPC update_order_status_atomic
DROP FUNCTION IF EXISTS public.update_order_status_atomic(uuid, text);
DROP FUNCTION IF EXISTS public.update_order_status_atomic(uuid, text, text);
CREATE OR REPLACE FUNCTION public.update_order_status_atomic(p_order_id uuid, p_new_status text, p_notes text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_status TEXT;
    v_user_id UUID;
BEGIN
  -- CHECK: Apenas admins podem alterar status de pedidos
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: Apenas administradores podem atualizar status de pedidos.';
  END IF;

  -- Get current status and user
  SELECT status, user_id INTO v_old_status, v_user_id FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;

  -- Update Order
  UPDATE public.marketplace_orders 
  SET status = p_new_status, updated_at = NOW() 
  WHERE id = p_order_id;

  -- Log History
  INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
  VALUES (p_order_id, v_old_status, p_new_status, p_notes, auth.uid());
END;
$$;

-- 4. RPC DEFINITIVA: create_marketplace_order_v11
CREATE OR REPLACE FUNCTION public.create_marketplace_order_v11(
    p_user_id uuid,
    p_items jsonb,
    p_total_amount numeric,
    p_shipping_cost numeric,
    p_payment_method text,
    p_address_id uuid,
    p_coupon_code text DEFAULT NULL,
    p_observation text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_id uuid;
    v_item jsonb;
    v_product_id uuid;
    v_variant_id uuid;
    v_quantity integer;
    v_price numeric;
    v_current_stock integer;
    v_calculated_total numeric := 0;
    v_coupon_id uuid;
    v_discount_amount numeric := 0;
BEGIN
    -- [SECURITY] Proteção contra BOLA: Forçar o user_id ser o do token atual
    IF p_user_id IS NULL OR p_user_id != auth.uid() THEN
        p_user_id := auth.uid();
    END IF;

    -- [SECURITY] Verificar se o endereço pertence ao usuário
    IF p_address_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'Endereço inválido ou não pertence ao usuário.';
    END IF;

    -- [LOGIC] Validar Cupom (Servidor-Side)
    IF p_coupon_code IS NOT NULL THEN
        SELECT id, COALESCE(discount_amount, 0) INTO v_coupon_id, v_discount_amount
        FROM coupons
        WHERE code = p_coupon_code 
          AND active = true 
          AND (valid_until IS NULL OR valid_until > now())
          AND (usage_limit IS NULL OR usage_count < usage_limit);
        
        IF v_coupon_id IS NULL THEN
            v_discount_amount := 0;
        END IF;
    END IF;

    -- Iniciar Inserção do Pedido
    INSERT INTO public.marketplace_orders (
        user_id, total_amount, shipping_cost, payment_method, address_id, coupon_id, status, observation
    ) VALUES (
        p_user_id, p_total_amount, p_shipping_cost, p_payment_method, p_address_id, v_coupon_id, 'pending', p_observation
    ) RETURNING id INTO v_order_id;

    -- Processar Itens com Bloqueio de Estoque para evitar Race Conditions
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        v_price := (v_item->>'price')::numeric;

        -- [SECURITY/INTEGRITY] Bloquear linha do produto/variante para decrementar estoque de forma atômica
        IF v_variant_id IS NOT NULL THEN
            SELECT stock INTO v_current_stock 
            FROM product_variants 
            WHERE id = v_variant_id FOR NO KEY UPDATE;
            
            IF v_current_stock < v_quantity THEN
                RAISE EXCEPTION 'Estoque insuficiente para a variante do produto.';
            END IF;

            UPDATE product_variants SET stock = stock - v_quantity WHERE id = v_variant_id;
        ELSE
            SELECT estoque INTO v_current_stock 
            FROM produtos 
            WHERE id = v_product_id FOR NO KEY UPDATE;

            IF v_current_stock < v_quantity THEN
                RAISE EXCEPTION 'Estoque insuficiente para o produto.';
            END IF;

            UPDATE produtos SET estoque = estoque - v_quantity WHERE id = v_product_id;
        END IF;

        -- Inserir item do pedido
        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, quantity, price
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_quantity, v_price
        );

        v_calculated_total := v_calculated_total + (v_price * v_quantity);
    END LOOP;

    -- Atualizar contador de uso do cupom se aplicável
    IF v_coupon_id IS NOT NULL THEN
        UPDATE coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_id;
    END IF;

    RETURN v_order_id;
END;
$$;

-- 5. Endurecimento do RLS (Row Level Security)

-- Profiles: Impedir alteração de role por usuários comuns
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile except role" ON public.profiles;
CREATE POLICY "Users can update own profile except role"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (
  auth.uid() = id AND 
  (CASE WHEN public.is_admin() THEN true ELSE role = (SELECT role FROM profiles WHERE id = auth.uid()) END)
);

-- Notificacoes: Impedir spam
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can insert notifications" ON public.notificacoes;
DROP POLICY IF EXISTS "Protected notification insertion" ON public.notificacoes;
CREATE POLICY "Protected notification insertion"
ON public.notificacoes FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = usuario_id OR public.is_admin()
);

-- Marketplace Orders: BOLA total
ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can see own orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Users can see own orders or admins" ON public.marketplace_orders;
CREATE POLICY "Users can see own orders or admins"
ON public.marketplace_orders FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.is_admin());

-- 6. Garantir permissões de execução para anon/authenticated nas funções necessárias
GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v11 TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_store_config TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_status_atomic TO authenticated;

COMMIT;
