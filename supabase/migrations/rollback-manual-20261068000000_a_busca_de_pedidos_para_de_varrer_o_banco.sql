-- ============================================================
-- Rollback manual de 20261068000000_a_busca_de_pedidos_para_de_varrer_o_banco.sql
-- (P-3, laudo varredura-profunda-molde-0109).
--
-- Devolve o estado de antes: apaga os 6 índices e os 2 wrappers, e
-- recria get_admin_orders_paged com o CORPO ORIGINAL da 20261028000000
-- (unaccent( cru). NÃO apaga a extensão pg_trgm (IF NOT EXISTS a
-- tolera; extensão sem índice é inofensiva).
-- ============================================================

DROP INDEX IF EXISTS public.idx_order_items_busca_produto;
DROP INDEX IF EXISTS public.idx_orders_busca_telefone;
DROP INDEX IF EXISTS public.idx_orders_busca_id;
DROP INDEX IF EXISTS public.idx_orders_busca_rastreio;
DROP INDEX IF EXISTS public.idx_orders_busca_cupom;
DROP INDEX IF EXISTS public.idx_orders_busca_cliente;

DROP FUNCTION IF EXISTS public.f_digitos(text);
DROP FUNCTION IF EXISTS public.f_unaccent(text);
CREATE OR REPLACE FUNCTION public.get_admin_orders_paged(p_search text DEFAULT ''::text, p_status text DEFAULT 'all'::text, p_start_date text DEFAULT ''::text, p_end_date text DEFAULT ''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_payment_status text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
    v_search_digitos TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);
    -- So os digitos do que a pessoa digitou. Serve para casar telefone
    -- independente de mascara -- ver a clausula do telefone abaixo.
    v_search_digitos := regexp_replace(v_clean_search, '[^0-9]', '', 'g');

    -- Compute total count with filters (before pagination)
    SELECT COUNT(o.id) INTO v_total_count
    FROM public.marketplace_orders o
    WHERE (
        p_status = 'all'
        OR (p_status = 'open' AND o.status NOT IN ('cancelled', 'delivered')) -- "Em Aberto": exclui cancelado e entregue
        OR o.status = p_status
      )
      -- Achado 10 do laudo (29/08): o filtro de pagamento existia so na
      -- tela — o painel buscava a pagina inteira e cortava em memoria,
      -- entao dormia enquanto o resultado cabia numa pagina. Filtra no
      -- banco, na contagem E nos dados; 'sem_cobranca' cobre o NULL
      -- (mesma regra de paymentStatusKey no front).
      AND (
        p_payment_status = 'all'
        OR (p_payment_status = 'sem_cobranca' AND o.payment_status IS NULL)
        OR o.payment_status = p_payment_status
      )
      AND (p_start_date = '' OR o.created_at >= p_start_date::TIMESTAMPTZ)
      AND (p_end_date = '' OR o.created_at <= p_end_date::TIMESTAMPTZ)
      AND (
        v_clean_search = '' OR (
          unaccent(o.customer_name) ILIKE unaccent('%' || v_clean_search || '%') OR
          o.id::TEXT ILIKE '%' || v_clean_search || '%' OR
          (
            -- TELEFONE: compara SO DIGITO com SO DIGITO, dos dois lados.
            -- O checkout grava mascarado -- `formatWhatsApp` em
            -- CheckoutView.tsx monta "(34) 98888-7777" -- entao a
            -- comparacao crua nunca casava o numero inteiro colado do
            -- WhatsApp. Normalizando os dois lados com o MESMO
            -- regexp_replace que o OTP ja usa, mascara deixa de importar.
            --
            -- 🔴 A GUARDA POR QUANTIDADE DE DIGITO NAO E DETALHE. Com
            -- `<> ''`, um termo de POUCOS digitos casava quase toda a
            -- base pela clausula do telefone -- MEDIDO em 23/08/2026 com
            -- o catalogo real: "3d" ia de 15 para 60 resultados, "caneta
            -- 3d" de 7 para 59, e "kit de adesivos 3d de microcenas" de 0
            -- para 59 -- porque o digito "3" sozinho aparece em 59 dos 84
            -- telefones deste banco (e "9" aparece em 84).
            --
            -- O LIMIAR E 4, NAO 6: com 6 a busca perde o caso de lembrar
            -- so os 4 ultimos digitos do telefone (ex.: "7777"), que e
            -- como se lembra um numero de cabeca -- MEDIDO acima. E 4 ja
            -- e a convencao deste schema: `get_orders_by_whatsapp_v3` em
            -- 20260323000002_repair_missing_rpcs_v25.sql:147 exige "pelo
            -- menos 4 dígitos" pelo mesmo motivo.
            --
            -- E A GUARDA CONTINUA NECESSARIA, so' com outro limiar: sem
            -- NENHUMA guarda, um termo sem digito (um NOME) reduz o termo
            -- a '' e `LIKE '%%'` casaria TODOS os pedidos por esta
            -- clausula -- o painel passaria a mostrar a lista inteira
            -- para qualquer texto. E' o defeito que o conserto ingenuo
            -- introduz.
            --
            -- O `coalesce` com o jsonb e o MESMO de
            -- `generate_order_otp_v1`/`v2`: pedido gravado pela RPC legada
            -- (que nunca preencheu a coluna) tambem passa a ser achavel.
            length(v_search_digitos) >= 4
            AND regexp_replace(
                  coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''),
                  '[^0-9]', '', 'g'
                ) LIKE '%' || v_search_digitos || '%'
          ) OR
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
        WHERE (
            p_status = 'all'
            OR (p_status = 'open' AND o.status NOT IN ('cancelled', 'delivered')) -- "Em Aberto": exclui cancelado e entregue
            OR o.status = p_status
          )
          -- Achado 10 do laudo (29/08): o filtro de pagamento existia so na
          -- tela — o painel buscava a pagina inteira e cortava em memoria,
          -- entao dormia enquanto o resultado cabia numa pagina. Filtra no
          -- banco, na contagem E nos dados; 'sem_cobranca' cobre o NULL
          -- (mesma regra de paymentStatusKey no front).
      AND (
        p_payment_status = 'all'
        OR (p_payment_status = 'sem_cobranca' AND o.payment_status IS NULL)
        OR o.payment_status = p_payment_status
      )
      AND (p_start_date = '' OR o.created_at >= p_start_date::TIMESTAMPTZ)
          AND (p_end_date = '' OR o.created_at <= p_end_date::TIMESTAMPTZ)
          AND (
            v_clean_search = '' OR (
              unaccent(o.customer_name) ILIKE unaccent('%' || v_clean_search || '%') OR
              o.id::TEXT ILIKE '%' || v_clean_search || '%' OR
              (
            -- TELEFONE: compara SO DIGITO com SO DIGITO, dos dois lados.
            -- O checkout grava mascarado -- `formatWhatsApp` em
            -- CheckoutView.tsx monta "(34) 98888-7777" -- entao a
            -- comparacao crua nunca casava o numero inteiro colado do
            -- WhatsApp. Normalizando os dois lados com o MESMO
            -- regexp_replace que o OTP ja usa, mascara deixa de importar.
            --
            -- 🔴 A GUARDA POR QUANTIDADE DE DIGITO NAO E DETALHE. Com
            -- `<> ''`, um termo de POUCOS digitos casava quase toda a
            -- base pela clausula do telefone -- MEDIDO em 23/08/2026 com
            -- o catalogo real: "3d" ia de 15 para 60 resultados, "caneta
            -- 3d" de 7 para 59, e "kit de adesivos 3d de microcenas" de 0
            -- para 59 -- porque o digito "3" sozinho aparece em 59 dos 84
            -- telefones deste banco (e "9" aparece em 84).
            --
            -- O LIMIAR E 4, NAO 6: com 6 a busca perde o caso de lembrar
            -- so os 4 ultimos digitos do telefone (ex.: "7777"), que e
            -- como se lembra um numero de cabeca -- MEDIDO acima. E 4 ja
            -- e a convencao deste schema: `get_orders_by_whatsapp_v3` em
            -- 20260323000002_repair_missing_rpcs_v25.sql:147 exige "pelo
            -- menos 4 dígitos" pelo mesmo motivo.
            --
            -- E A GUARDA CONTINUA NECESSARIA, so' com outro limiar: sem
            -- NENHUMA guarda, um termo sem digito (um NOME) reduz o termo
            -- a '' e `LIKE '%%'` casaria TODOS os pedidos por esta
            -- clausula -- o painel passaria a mostrar a lista inteira
            -- para qualquer texto. E' o defeito que o conserto ingenuo
            -- introduz.
            --
            -- O `coalesce` com o jsonb e o MESMO de
            -- `generate_order_otp_v1`/`v2`: pedido gravado pela RPC legada
            -- (que nunca preencheu a coluna) tambem passa a ser achavel.
            length(v_search_digitos) >= 4
            AND regexp_replace(
                  coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''),
                  '[^0-9]', '', 'g'
                ) LIKE '%' || v_search_digitos || '%'
          ) OR
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
$function$;
