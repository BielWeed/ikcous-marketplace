-- O fragmento do pedido não aceita curinga de LIKE (laudo caça-bugs do
-- molde, 30-31/08/2026, achado A4).
--
-- CAUSA RAIZ PROVADA: `get_orders_by_whatsapp_v3` guarda só o COMPRIMENTO do
-- fragmento (`LENGTH < 4`) e o cola cru em `LIKE '%' || p_order_fragment` —
-- tanto em `o.id::text` quanto em `o.tracking_code`. `%` e `_` são curingas
-- de LIKE: quatro underscores (`____`) casam QUALQUER uuid e devolvem o
-- histórico inteiro do usuário — com `customer_data` (whatsapp, e-mail,
-- endereço) e o endereço completo (`to_jsonb(addr.*)`). Basta saber
-- telefone + e-mail da vítima, que é exatamente o que a tela de busca pede.
--
-- A mesma casa já consertou essa classe para o OTP: `generate_order_otp_v2`
-- (20260820000000) exige `^[0-9a-fA-F-]{6,}$`. Aqui a whitelist do OTP NÃO
-- serve de cópia: o MESMO parâmetro também casa `tracking_code` (código de
-- rastreio dos Correios tem letras fora de a-f — "SM...", "OD..."), e a
-- guarda do OTP quebraria a busca por rastreio. O conserto é o espelho
-- invertido: recusar o CURINGA, não o alfabeto.
--
-- O que muda aqui:
--   1. CREATE OR REPLACE da função com a guarda nova logo após a guarda de
--      comprimento: fragmento contendo `%`, `_` ou `\` levanta
--      'Fragmento inválido.' antes de tocar em linha nenhuma. Corpo
--      restante VERBATIM do baseline (20260806000000:2359-2434).
--
-- `CREATE OR REPLACE FUNCTION` preserva GRANT/dono (lição 448 do _REGRAS);
-- assinatura repetida idêntica para não criar sobrecarga silenciosa.
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK da prova vira no-op).
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (rodar contra o banco, com telefone/
-- e-mail/uuid REAIS de um usuário de teste):
--   -- 1. Curinga recusado (4 underscores = casa qualquer uuid):
--   BEGIN;
--     SELECT count(*) FROM public.get_orders_by_whatsapp_v3(
--       '<telefone-do-usuario>', '<email-do-mesmo-usuario>', '____');
--     -> espera ERRO 'Fragmento inválido.' (antes: histórico inteiro)
--   ROLLBACK;
--   -- 2. Fragmento legítimo continua entrando (controle positivo — prefixo
--   --    real de uuid de pedido do próprio usuário, ≥4 chars hexa):
--   BEGIN;
--     SELECT count(*) FROM public.get_orders_by_whatsapp_v3(
--       '<telefone-do-usuario>', '<email-do-mesmo-usuario>',
--       '<6-primeiros-chars-de-um-uuid-de-pedido-dele>');
--     -> espera rodar SEM erro (count do(s) pedido(s) que casam)
--   ROLLBACK;
--   -- 3. Rastreio com letras fora de a-f continua entrando (o motivo de NÃO
--   --    copiar a whitelist do OTP):
--   BEGIN;
--     SELECT count(*) FROM public.get_orders_by_whatsapp_v3(
--       '<telefone-do-usuario>', '<email-do-mesmo-usuario>',
--       '<prefixo-do-tracking-code-real-dele>');
--     -> espera rodar SEM erro
--   ROLLBACK;
--
-- ROLLBACK MANUAL: versionado em
-- rollback-manual-20261035000000_fragmento_do_pedido_nao_aceita_curinga.sql

CREATE OR REPLACE FUNCTION public.get_orders_by_whatsapp_v3("p_phone_number" "text", "p_customer_email" "text", "p_order_fragment" "text") RETURNS SETOF "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_user_id UUID;
BEGIN
    IF LENGTH(p_order_fragment) < 4 THEN
        RAISE EXCEPTION 'Fragmento muito curto. Informe pelo menos 4 dígitos.';
    END IF;

    -- Guarda de curinga (laudo 31/08, achado A4): o fragmento entra cru em
    -- `LIKE '%' || fragmento` — `%`, `_` e `\` ampliariam a busca (____
    -- casa qualquer uuid e devolve o histórico inteiro do usuário). A
    -- whitelist do OTP v2 não serve de cópia: este parâmetro também casa
    -- tracking_code, que tem letras fora de a-f. Recusa o curinga, não o
    -- alfabeto.
    IF p_order_fragment ~ '[%_\\]' THEN
        RAISE EXCEPTION 'Fragmento inválido.';
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
