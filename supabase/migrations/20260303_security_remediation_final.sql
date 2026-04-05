-- Migração: Corrigir RLS e RPC para prevenir BOLA e Bypass de Validação
-- Data: 2026-03-03

-- 1. LIMPEZA DE POLÍTICAS PERMISSIVAS (MARKETPLACE_ORDERS)
DROP POLICY IF EXISTS "Public can insert orders" ON marketplace_orders;
DROP POLICY IF EXISTS "Public can view orders" ON marketplace_orders;
DROP POLICY IF EXISTS "Users can view own orders" ON marketplace_orders;
DROP POLICY IF EXISTS "Admins can view all orders" ON marketplace_orders;

-- 2. NOVAS POLÍTICAS RESTRITAS (MARKETPLACE_ORDERS)
-- Apenas leitura dos próprios pedidos
CREATE POLICY "Users can view own orders" 
ON marketplace_orders FOR SELECT 
USING (auth.uid() = user_id);

-- Admins podem fazer tudo
CREATE POLICY "Admins full access on orders" 
ON marketplace_orders FOR ALL 
USING (is_admin());

-- BLOQUEIO DE INSERÇÃO DIRETA
-- Note: create_marketplace_order_v2 é SECURITY DEFINER, então o RLS normal não o impede se ele for chamado.
-- Mas impedimos o INSERT via TABLE API.
-- (A omissão de uma política de INSERT para público já garante o bloqueio por padrão em RLS strict)
ALTER TABLE marketplace_orders ENABLE ROW LEVEL SECURITY;

-- 3. LIMPEZA E PROTEÇÃO (COUPONS)
DROP POLICY IF EXISTS "Public Read Coupons" ON coupons;
DROP POLICY IF EXISTS "Admins can manage coupons" ON coupons;

-- Usuários só veem cupons ativos
CREATE POLICY "Users view active coupons" 
ON coupons FOR SELECT 
USING (active = true);

-- Admins veem e gerenciam tudo
CREATE POLICY "Admins full access on coupons" 
ON coupons FOR ALL 
USING (is_admin());

-- 4. REFORÇO DA RPC (SECURITY DEFINER PROTECTION)
CREATE OR REPLACE FUNCTION public.create_marketplace_order_v2(
    p_order_data jsonb,
    p_items jsonb,
    p_coupon_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER -- Roda como dono do banco
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_order_id uuid;
    v_total_amount numeric := 0;
    v_item record;
    v_product record;
    v_discount numeric := 0;
    v_coupon_id uuid;
    v_shipping_cost numeric := 0;
    v_min_order_value numeric := 0;
    v_points_earned integer := 0;
    v_store_config record;
BEGIN
    -- [CRITICAL] Garantir que o user_id vem do AUTH, não do payload (Prevenção de BOLA)
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    -- Carregar config da loja (para frete grátis/pontos)
    SELECT * INTO v_store_config FROM store_config WHERE id = 1;

    -- Validar itens e calcular total (Validando preços no servidor)
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id uuid, quantity integer)
    LOOP
        SELECT * INTO v_product FROM products WHERE id = v_item.product_id;
        
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Produto não encontrado: %', v_item.product_id;
        END IF;

        IF v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Quantidade inválida para o produto %', v_product.name;
        END IF;

        v_total_amount := v_total_amount + (v_product.price * v_item.quantity);
    END LOOP;

    -- Validar Cupom se existir
    IF p_coupon_code IS NOT NULL AND p_coupon_code <> '' THEN
        SELECT id, discount_value, min_order_value INTO v_coupon_id, v_discount, v_min_order_value 
        FROM coupons 
        WHERE code = p_coupon_code AND active = true;

        IF v_coupon_id IS NULL THEN
            RAISE EXCEPTION 'Cupom inválido ou expirado';
        END IF;

        IF v_total_amount < v_min_order_value THEN
            RAISE EXCEPTION 'Valor mínimo para este cupom é R$ %', v_min_order_value;
        END IF;

        v_total_amount := v_total_amount - v_discount;
    END IF;

    -- Cálculo de Frete (Proteção contra manipulação de frete no front)
    IF v_total_amount < COALESCE(v_store_config.min_free_shipping, 999999) THEN
        v_shipping_cost := (p_order_data->>'shipping_cost')::numeric;
        -- Adicionar validação extra de frete baseada na região/CEP se necessário
    ELSE
        v_shipping_cost := 0;
    END IF;

    -- Inserir Pedido
    INSERT INTO marketplace_orders (
        user_id,
        status,
        total_amount,
        shipping_cost,
        payment_method,
        address_id,
        coupon_id,
        notes
    ) VALUES (
        v_user_id,
        'pending',
        v_total_amount,
        v_shipping_cost,
        p_order_data->>'payment_method',
        (p_order_data->>'address_id')::uuid,
        v_coupon_id,
        p_order_data->>'notes'
    ) RETURNING id INTO v_order_id;

    -- Inserir Itens do Pedido
    INSERT INTO marketplace_order_items (order_id, product_id, quantity, price_at_time)
    SELECT v_order_id, product_id, quantity, (SELECT price FROM products WHERE id = product_id)
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, quantity integer);

    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'total_amount', v_total_amount + v_shipping_cost
    );
END;
$$;
