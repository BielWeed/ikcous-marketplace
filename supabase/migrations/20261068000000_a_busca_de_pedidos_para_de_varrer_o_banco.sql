-- ============================================================
-- P-3 (laudo varredura-profunda-molde-0109, onda 3) — a busca do painel
-- para de varrer o banco: índice de trigrama para as colunas buscadas.
--
-- O DEFEITO MEDIDO: cada busca do painel roda a RPC duas vezes (count +
-- dados) e cada passada é O(pedidos) com unaccent(coluna) ILIKE
-- '%termo%' — função de dicionário embrulhando a coluna, iníndexável.
-- Em catálogo grande são segundos de CPU por pausa de digitação, no
-- Postgres compartilhado. Nenhuma migration criava pg_trgm (grep em
-- todas).
--
-- O CONSERTO, em 4 peças:
--   1. pg_trgm + wrapper IMMUTABLE f_unaccent — unaccent é STABLE
--      (dicionário), então índice de expressão exige o wrapper com a
--      extensão QUALIFICADA (vive em extensions, provado ao vivo).
--      Mesmo dicionário de sempre — resultados idênticos (prova
--      db-prove antes/depois).
--   2. wrapper f_digitos (IMMUTABLE) para a cláusula do TELEFONE, que
--      normaliza os dois lados com regexp_replace — a guarda de >=4
--      dígitos do corpo continua valendo (comentário lá explica por
--      quê).
--   3. 6 índices GIN de expressão: customer_name, coupon_code,
--      tracking_code, id::text, telefone e order_items.product_name.
--   4. Recria get_admin_orders_paged (7 args, a única sobrecarga viva)
--      com o corpo de 20261028000000 e unaccent( -> public.f_unaccent(
--      nas 16 chamadas (8 linhas, coluna + padrão) — NADA mais muda no comportamento.
--
-- FICHA DE VERIFICAÇÃO POS-APLICAÇÃO:
--   1. SELECT extname FROM pg_extension WHERE extname='pg_trgm';
--      -> 1 linha
--   2. SELECT proname, count(*) FROM pg_proc p JOIN pg_namespace n ON
--      n.oid=p.pronamespace WHERE n.nspname='public' AND
--      proname='get_admin_orders_paged' GROUP BY 1;
--      -> UMA sobrecarga (7 args)
--   3. SELECT indexname FROM pg_indexes WHERE indexname IN
--      ('idx_orders_busca_cliente','idx_orders_busca_cupom',
--       'idx_orders_busca_rastreio','idx_orders_busca_id',
--       'idx_orders_busca_telefone',
--       'idx_order_items_busca_produto'); -> 6 linhas
--   4. EXPLAIN SELECT 1 FROM marketplace_orders WHERE
--      public.f_unaccent(customer_name) ILIKE '%jose%';
--      -> Bitmap/Index Scan citando idx_orders_busca_cliente
--   5. Prova completa: node scripts/db-prove-busca-trgm.cjs
--      (transação, ROLLBACK — nada gravado)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ============================================================
-- GARANTIA do dicionário unaccent no schema `extensions` (pega o caso
-- medido na Savy em 01/09: a 20261032 instalou a extensão SEM schema e o
-- db-apply dela a plantou em `public` — o wrapper abaixo qualifica
-- `extensions.unaccent` e a aplicação morria com "text search dictionary
-- extensions.unaccent does not exist"). Idempotente: se a extensão já
-- está em `extensions` (o caso do dev do molde), o DO é no-op. O
-- search_path das funções existentes ('public','extensions') continua
-- resolvendo `unaccent(...)` cru depois da mudança de casa.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
DO $mover_unaccent$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'unaccent' AND n.nspname <> 'extensions'
  ) THEN
    ALTER EXTENSION unaccent SET SCHEMA extensions;
  END IF;
END
$mover_unaccent$;

-- unaccent é STABLE (dicionário) — índice de expressão pede IMMUTABLE.
-- Qualificação total: o search_path da função não se aplica a índice.
CREATE OR REPLACE FUNCTION public.f_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $function$
    SELECT extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$function$;

-- Mesma razão para o telefone: regexp_replace é IMMUTABLE, o índice pede
-- função qualificada e imutável.
CREATE OR REPLACE FUNCTION public.f_digitos(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $function$
    SELECT regexp_replace($1, '[^0-9]', '', 'g')
$function$;

CREATE INDEX IF NOT EXISTS idx_orders_busca_cliente
    ON public.marketplace_orders USING gin ((public.f_unaccent(customer_name)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_busca_cupom
    ON public.marketplace_orders USING gin ((public.f_unaccent(coupon_code)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_busca_rastreio
    ON public.marketplace_orders USING gin ((public.f_unaccent(tracking_code)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_busca_id
    ON public.marketplace_orders USING gin ((id::text) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_busca_telefone
    ON public.marketplace_orders USING gin ((public.f_digitos(coalesce(customer_phone, customer_data->>'whatsapp', ''))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_order_items_busca_produto
    ON public.marketplace_order_items USING gin ((public.f_unaccent(product_name)) gin_trgm_ops);

-- ============================================================
-- get_admin_orders_paged — corpo EXATO da 20261028000000 (a viva, única
-- sobrecarga) com as 8 chamadas unaccent( trocadas por
-- public.f_unaccent(. Troca mecânica, conferida por contagem no script
-- que gerou este arquivo; comportamento de busca idêntico (prova
-- db-prove compara resultados antes/depois com acentos e sem).
-- ============================================================
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
          public.f_unaccent(o.customer_name) ILIKE public.f_unaccent('%' || v_clean_search || '%') OR
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
          public.f_unaccent(o.coupon_code) ILIKE public.f_unaccent('%' || v_clean_search || '%') OR
          public.f_unaccent(o.tracking_code) ILIKE public.f_unaccent('%' || v_clean_search || '%') OR
          EXISTS (
              SELECT 1 FROM public.marketplace_order_items oi
              WHERE oi.order_id = o.id
                AND public.f_unaccent(oi.product_name) ILIKE public.f_unaccent('%' || v_clean_search || '%')
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
              public.f_unaccent(o.customer_name) ILIKE public.f_unaccent('%' || v_clean_search || '%') OR
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
              public.f_unaccent(o.coupon_code) ILIKE public.f_unaccent('%' || v_clean_search || '%') OR
              public.f_unaccent(o.tracking_code) ILIKE public.f_unaccent('%' || v_clean_search || '%') OR
              EXISTS (
                  SELECT 1 FROM public.marketplace_order_items oi
                  WHERE oi.order_id = o.id
                    AND public.f_unaccent(oi.product_name) ILIKE public.f_unaccent('%' || v_clean_search || '%')
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
