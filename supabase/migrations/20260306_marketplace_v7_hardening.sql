-- [MIGRAÇÃO CORRIGIDA] 20260306_marketplace_v7_hardening.sql
-- Adiciona colunas faltantes e implementa RPC v7 robusto.

-- 1. Garantir colunas de controle na tabela coupons
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='coupons' AND column_name='used_count') THEN
        ALTER TABLE coupons ADD COLUMN used_count INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='coupons' AND column_name='usage_limit') THEN
        ALTER TABLE coupons ADD COLUMN usage_limit INTEGER;
    END IF;
END $$;

-- 2. Função auxiliar para verificar estoque (Atomic Check)
CREATE OR REPLACE FUNCTION check_stock_v1(p_product_id UUID, p_variant_id UUID, p_quantity INTEGER)
RETURNS BOOLEAN AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Reforço de RLS para user_addresses (Prevenção de BOLA)
DROP POLICY IF EXISTS "Users can update their own addresses" ON user_addresses;
CREATE POLICY "Users can update their own addresses"
ON user_addresses FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own addresses" ON user_addresses;
CREATE POLICY "Users can delete their own addresses"
ON user_addresses FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- 4. Proteção da tabela de cupons (Apenas admin ou cupons ativos)
DROP POLICY IF EXISTS "Anyone can view active coupons" ON coupons;
CREATE POLICY "Anyone can view active coupons"
ON coupons FOR SELECT
TO authenticated
USING (
    is_admin() OR 
    (active = true AND (usage_limit IS NULL OR used_count < usage_limit))
);

-- 5. RPC v7: create_marketplace_order_v7
CREATE OR REPLACE FUNCTION create_marketplace_order_v7(
    p_address_id UUID,
    p_items JSONB,
    p_coupon_code TEXT DEFAULT NULL,
    p_payment_method TEXT DEFAULT 'pix'
)
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_order_id UUID;
    v_subtotal NUMERIC := 0;
    v_discount NUMERIC := 0;
    v_shipping NUMERIC := 0;
    v_total NUMERIC := 0;
    v_item RECORD;
    v_product RECORD;
    v_variant RECORD;
    v_coupon RECORD;
    v_store_config RECORD;
BEGIN
    -- Validação de Auth
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    -- Carregar Configuração da Loja (1 linha fixa)
    SELECT * INTO v_store_config FROM store_config LIMIT 1;

    -- Início do Loop de Itens para validação de Estoque e Preço
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID, variant_id UUID, quantity INTEGER)
    LOOP
        -- 1. Validar Produto e Estoque
        SELECT * INTO v_product FROM produtos WHERE id = v_item.product_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Produto não encontrado';
        END IF;

        IF v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Quantidade inválida';
        END IF;

        -- 2. Validar Variantes e Estoque Atômico
        IF v_item.variant_id IS NOT NULL THEN
            SELECT * INTO v_variant FROM product_variants WHERE id = v_item.variant_id AND product_id = v_item.product_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Variante inválida';
            END IF;
            
            IF v_variant.stock < v_item.quantity THEN
                RAISE EXCEPTION 'Estoque insuficiente para a variante';
            END IF;
            
            v_subtotal := v_subtotal + (COALESCE(v_variant.price_override, v_product.preco) * v_item.quantity);
        ELSE
            IF v_product.stock < v_item.quantity THEN
                RAISE EXCEPTION 'Estoque insuficiente para o produto %', v_product.nome;
            END IF;
            v_subtotal := v_subtotal + (v_product.preco * v_item.quantity);
        END IF;
    END LOOP;

    -- 3. Lógica de Frete (Consistente com checkout_v6)
    IF v_subtotal < v_store_config.min_free_shipping THEN
        v_shipping := v_store_config.shipping_cost;
    ELSE
        v_shipping := 0;
    END IF;

    -- 4. Lógica de Cupom (Rígida no Servidor)
    IF p_coupon_code IS NOT NULL THEN
        SELECT * INTO v_coupon FROM coupons WHERE code = p_coupon_code AND active = true;
        IF FOUND THEN
            IF v_coupon.usage_limit IS NULL OR v_coupon.used_count < v_coupon.usage_limit THEN
                IF v_coupon.discount_type = 'percentage' THEN
                    v_discount := (v_subtotal * v_coupon.discount_value / 100);
                ELSE
                    v_discount := v_coupon.discount_value;
                END IF;
                -- Incrementar uso do cupom
                UPDATE coupons SET used_count = used_count + 1 WHERE id = v_coupon.id;
            END IF;
        END IF;
    END IF;

    v_total := v_subtotal - v_discount + v_shipping;

    -- 5. Criar o Pedido
    INSERT INTO marketplace_orders (
        user_id, address_id, subtotal, discount, shipping_cost, total_amount, payment_method, status
    ) VALUES (
        v_user_id, p_address_id, v_subtotal, v_discount, v_shipping, v_total, p_payment_method, 'pending'
    ) RETURNING id INTO v_order_id;

    -- 6. Inserir Itens e Baixar Estoque Atômico
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID, variant_id UUID, quantity INTEGER)
    LOOP
        INSERT INTO marketplace_order_items (
            order_id, product_id, variant_id, quantity, unit_price
        ) VALUES (
            v_order_id, v_item.product_id, v_item.variant_id, v_item.quantity,
            CASE 
                WHEN v_item.variant_id IS NOT NULL THEN 
                    (SELECT COALESCE(price_override, (SELECT preco FROM produtos WHERE id = v_item.product_id)) 
                     FROM product_variants WHERE id = v_item.variant_id)
                ELSE (SELECT preco FROM produtos WHERE id = v_item.product_id)
            END
        );

        -- Baixa de estoque
        IF v_item.variant_id IS NOT NULL THEN
            UPDATE product_variants SET stock = stock - v_item.quantity WHERE id = v_item.variant_id;
        ELSE
            UPDATE produtos SET stock = stock - v_item.quantity WHERE id = v_item.product_id;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'message', 'Pedido v7 criado com sucesso e estoque reservado.'
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
