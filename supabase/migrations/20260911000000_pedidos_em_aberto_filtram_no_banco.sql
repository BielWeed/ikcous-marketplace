-- O botao padrao "Todos Ativos" da tela de Pedidos manda p_status='all', e a
-- funcao (versao viva desde o baseline) faz WHERE (p_status = 'all' OR
-- o.status = p_status) -- ou seja, o padrao literalmente NAO filtra nada: 83
-- pedidos aparecem, 72 deles (86,7%) cancelados, e a lista some da tela
-- assim que o cliente rola a pagina.
--
-- O Gabriel aprovou (20/08/2026, resposta ao veto "pode tirar o
-- finalizado"): o padrao passa a ser "Em Aberto", que exclui cancelled E
-- delivered. Sobram 8 dos 83 pedidos de hoje.
--
-- O novo comportamento viaja pelo PARAMETRO QUE JA EXISTE -- p_status='open'
-- -- em vez de um parametro novo. NAO se muda a assinatura da funcao: no
-- Postgres, CREATE FUNCTION com lista de argumentos diferente cria uma
-- SEGUNDA funcao sobrecarregada em vez de substituir a existente, e a
-- chamada via PostgREST fica ambigua entre as duas. Com a assinatura
-- identica ao baseline (mesmos 6 parametros, mesmos nomes, mesmos tipos,
-- mesmos DEFAULTs), CREATE OR REPLACE substitui de verdade.
--
-- A clausula de filtro aparece DUAS VEZES dentro da funcao -- uma no SELECT
-- COUNT(o.id) INTO v_total_count (o total que vira o rodape/paginacao) e
-- outra no SELECT ... FROM (...) que busca as linhas exibidas na lista.
-- Trocar so uma recria exatamente o defeito que este marketplace ja teve
-- antes (lista mostrando uma coisa, contagem mostrando outra) -- por isso as
-- duas ocorrencias abaixo tem o mesmo terceiro ramo.
--
-- O terceiro ramo (p_status='open' AND o.status NOT IN ('cancelled',
-- 'delivered')) so entra em jogo quando p_status='open'; para qualquer outro
-- valor de p_status ele e sempre falso, porque nenhum pedido tem
-- status='open' na coluna real -- o comportamento dos demais filtros
-- individuais (p_status='pending', 'cancelled' etc.) fica intocado.
--
-- Sem BEGIN/COMMIT de proposito: com eles, o ROLLBACK do script de prova
-- vira no-op e a mudanca fica gravada mesmo assim.

CREATE OR REPLACE FUNCTION public.get_admin_orders_paged("p_search" "text" DEFAULT ''::"text", "p_status" "text" DEFAULT 'all'::"text", "p_start_date" "text" DEFAULT ''::"text", "p_end_date" "text" DEFAULT ''::"text", "p_page" integer DEFAULT 0, "p_page_size" integer DEFAULT 10) RETURNS "jsonb"
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
    WHERE (
        p_status = 'all'
        OR (p_status = 'open' AND o.status NOT IN ('cancelled', 'delivered')) -- "Em Aberto": exclui cancelado e entregue
        OR o.status = p_status
      )
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
        WHERE (
            p_status = 'all'
            OR (p_status = 'open' AND o.status NOT IN ('cancelled', 'delivered')) -- "Em Aberto": exclui cancelado e entregue
            OR o.status = p_status
          )
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
