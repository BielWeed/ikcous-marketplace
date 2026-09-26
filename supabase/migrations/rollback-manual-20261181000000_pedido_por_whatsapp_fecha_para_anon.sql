-- ROLLBACK MANUAL de 20261181000000_pedido_por_whatsapp_fecha_para_anon.sql
-- (achado LGPD, alto — auditoria de 26/09/2026).
--
-- Desfaz NA ORDEM INVERSA da migration:
--   1. `get_orders_by_otp_v1` volta ao corpo EXATO que a
--      `20260950000000_rastreio_por_codigo_mostra_o_pagamento.sql` deixava
--      (`customer_data` cru de novo, com CPF quando o pedido tiver) — cópia
--      byte a byte, mesma assinatura, sem `DROP`.
--   2. `get_orders_by_whatsapp_v3` recebe de volta `GRANT EXECUTE ... TO
--      PUBLIC` — cobre `anon` e `authenticated` no mesmo comando, porque
--      antes desta migration nenhuma delas tinha um REVOKE próprio: o
--      alcance vinha inteiro do `PUBLIC` (mesma técnica de
--      `rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql`,
--      que restaura esta mesma função da mesma forma).
--
-- ⚠️ O rollback REABRE o achado LGPD (convidado sem OTP volta a ler
-- `customer_data` — incluindo CPF — de qualquer pedido só com telefone +
-- e-mail + 4 caracteres do id/rastreio). Rodar só se a migration quebrar
-- algo legítimo, e consertar o conserto na sequência.
--
-- DADOS: nada é apagado nem reescrito — pedido que já tem `customer_data.cpf`
-- gravado continua tendo; este rollback só devolve a FORMA da resposta da
-- RPC e o ACL da outra, não toca linha nenhuma de `marketplace_orders`.
--
-- MODO DE APLICAÇÃO: `psql "$DATABASE_URL" -1 -f
-- rollback-manual-20261181000000_pedido_por_whatsapp_fecha_para_anon.sql`
-- (ou `node scripts/db-apply.cjs` se for para registrar no ledger como
-- migration nova — avalie com quem revisar). SEM `BEGIN`/`COMMIT` de nível
-- superior neste arquivo (regra da casa).

GRANT EXECUTE ON FUNCTION public.get_orders_by_whatsapp_v3(text,text,text) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v1("p_email" "text", "p_otp" "text") RETURNS "jsonb"
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
                'payment_status', o.payment_status,
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
