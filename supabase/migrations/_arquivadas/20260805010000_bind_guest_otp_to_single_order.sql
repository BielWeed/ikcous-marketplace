-- =============================================================================
-- OTP de convidado amarrado a um pedido específico (AUTH-010, #118)
-- =============================================================================
--
-- ESTADO MEDIDO NO BANCO EM 05/08/2026, não deduzido do repositório
-- (scripts/db-inspect-auth-010.cjs):
--
--   otp_verifications: id, email, whatsapp, otp_code, expires_at, verified,
--                      created_at. SEM order_id, SEM attempts. **0 LINHAS.**
--   RLS ligado, uma policy: "Admins full access" [ALL] roles={authenticated}.
--   Trigger on_otp_created_send_email -> handle_new_otp_verification()
--   As duas RPCs são SECURITY DEFINER, com EXECUTE para anon.
--   Corpo vivo de generate_order_otp_v1: OR entre canais e `ILIKE '%' || frag`
--   confirmados — o que a issue descreve continua exatamente assim.
--
-- O ATAQUE, ponta a ponta
--   1. Atacante chama generate_order_otp_v1(email_dele, whatsapp_da_vítima, '').
--      Fragmento vazio vira `ILIKE '%'`, que casa qualquer pedido; e o OR entre
--      canais faz o WhatsApp da vítima bastar sozinho.
--   2. O INSERT grava email = o do ATACANTE e whatsapp = o da VÍTIMA. O trigger
--      manda o código de 6 dígitos para a caixa do atacante.
--   3. get_orders_by_otp_v1(email_dele, código) lê o whatsapp guardado no
--      registro e devolve TODOS os pedidos da vítima: nome, e-mail, telefone,
--      itens, totais e o endereço completo.
--   Sem limite de tentativas em nenhum ponto.
--
-- O QUE ESTA MIGRATION NÃO TOCA, e o motivo
--   `handle_new_otp_verification` NÃO é recriada aqui. O corpo vivo posta para
--   https://jvgyjlbjhbfrncwbytls.functions.supabase.co/send-otp-email — um
--   SEGUNDO projeto Supabase — enquanto o arquivo do repo
--   (20260708190000_secure_otp_flow.sql:92) aponta para cafkrminfnokvgjqtkle.
--   Medido hoje, não lembrado. Um CREATE OR REPLACE nela apagaria o
--   redirecionamento e derrubaria o envio do código sem erro aparente. O destino
--   desse segundo projeto é a PEDIDO-050 (#85) e a AUTH-020 (#41).
--
-- POR QUE O CAMINHO DE FALHA RETORNA EM VEZ DE `RAISE`
--   No PostgREST cada chamada de RPC é uma transação. Um RAISE reverteria o
--   UPDATE que incrementa `attempts`, e o contador nunca sairia de zero — o
--   limite de tentativas seria decorativo. Por isso get_orders_by_otp_v1 passa a
--   devolver um objeto de erro. Isso MUDA O CONTRATO com o front, tratado no
--   mesmo PR (useOrders.ts:906).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. A tabela ganha o vínculo e o contador
-- ----------------------------------------------------------------------------
-- A tabela está vazia (medido), então NOT NULL sem default passa direto. O
-- DELETE cobre a corrida de alguém pedir um código entre a medição e o apply:
-- OTP é dado efêmero de 15 minutos, e o pior caso é um convidado pedir outro.
DELETE FROM public.otp_verifications;

ALTER TABLE public.otp_verifications
    ADD COLUMN IF NOT EXISTS order_id uuid NOT NULL
        REFERENCES public.marketplace_orders(id) ON DELETE CASCADE;

ALTER TABLE public.otp_verifications
    ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.otp_verifications.order_id IS
    'Pedido ao qual este código dá acesso. Antes da AUTH-010 (#118) o código '
    'abria todos os pedidos que casassem com o e-mail OU o WhatsApp.';
COMMENT ON COLUMN public.otp_verifications.attempts IS
    'Tentativas erradas. Em 5, o código morre. Incrementado no caminho de falha, '
    'que RETORNA em vez de RAISE: no PostgREST o RAISE reverteria o incremento.';

CREATE INDEX IF NOT EXISTS idx_otp_verifications_email_pendente
    ON public.otp_verifications (email, expires_at DESC)
    WHERE verified = false;

-- ----------------------------------------------------------------------------
-- 2. Gerar o código exige os dois canais E um pedido específico
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_order_otp_v1(
    p_email text, p_whatsapp text, p_order_fragment text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

-- ----------------------------------------------------------------------------
-- 3. Resgatar o código devolve UM pedido, e conta tentativa
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v1(
    p_email text, p_otp text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;
