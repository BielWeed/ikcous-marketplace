-- REVERSAO de supabase/migrations/20260950000000_rastreio_por_codigo_mostra_o_pagamento.sql
--
-- ESCRITA A MAO, e o nome comeca com rollback-manual- de PROPOSITO: o .gitignore
-- ignora rollback-*.sql (artefato que o db-apply gera) e abre excecao so para
-- !rollback-manual-*.sql. Fora do git, a unica copia deste arquivo moraria numa
-- maquina so. Ha um exemplar exatamente assim neste repositorio hoje
-- (rollback-20260940000000_home_sections_em_store_config.sql, 7,4 KB de trabalho
-- cuidadoso, INVISIVEL para o git por causa do nome).
--
-- O QUE ELA FAZ: devolve get_orders_by_otp_v1 ao corpo que estava VIVO antes da
-- ida, ou seja, sem a chave payment_status no objeto do pedido. O efeito visivel
-- e voltar o defeito: quem rastreia pedido por codigo, sem login, volta a ver
-- todo pedido como se nao houvesse cobranca. Isso e esperado — reversao restaura o
-- estado anterior, defeito incluido.
--
-- 🔴 NAO PERDE DADO. Aqui nao ha DROP COLUMN nem DELETE: a coluna payment_status
-- NAO e desta migration (ela entrou em 20260807000000_reserva_com_expiracao.sql,
-- um dia DEPOIS do baseline, e e a origem do defeito). A ida so passou a LER a
-- coluna; a volta so para de ler. Nenhum pedido, nenhum pagamento e nenhum
-- historico e tocado nos dois sentidos.
--
-- 🔴 ISTO TAMBEM E CREATE OR REPLACE, ou seja, SUBSTITUICAO: atributo que nao for
-- repetido por extenso SOME EM SILENCIO. Por isso RETURNS "jsonb", LANGUAGE
-- plpgsql, SECURITY DEFINER e SET search_path TO 'public' estao escritos aqui de
-- novo. Se SECURITY DEFINER cair na VOLTA, a funcao que le pedido de terceiro
-- passa a rodar com a permissao de quem chama — o navegador de quem digitou o
-- codigo. Reverter nao pode ser mais perigoso que aplicar.
--
-- Assinatura identica: ("p_email" "text", "p_otp" "text"). Parametro a mais nao
-- substitui, cria uma SEGUNDA funcao.
--
-- SEM BEGIN/COMMIT, pelo mesmo motivo da migration: com eles o ROLLBACK do
-- script de prova vira no-op e a mudanca fica gravada mesmo assim.
--
-- Corpo copiado byte a byte do baseline 20260806000000, linhas 2269-2353 — a
-- definicao VIVA. CINCO migrations ativas definem esta funcao e so a ultima vale.
--
-- Provada junto com a ida em scripts/db-prove-otp-mostra-pagamento.cjs, caso 9:
-- aplica a migration, confirma a chave PRESENTE (controle negativo da volta),
-- aplica esta reversao, confirma a chave AUSENTE, e ROLLBACK no fim.

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
