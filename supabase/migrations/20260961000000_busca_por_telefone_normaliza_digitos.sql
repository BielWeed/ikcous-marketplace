-- A busca do painel passa a achar o pedido pelo telefone colado do WhatsApp.
--
-- O DEFEITO, em uma frase: a tela promete "pesquise pedidos por ID, nome do
-- cliente ou telefone", o checkout grava o telefone MASCARADO, e a busca compara
-- texto cru -- entao colar o numero inteiro nunca acha nada.
--
-- MEDIDO EM 23/08/2026, no banco vivo:
--
--     pedidos no total ................................. 83
--     com telefone guardado ............................ 83
--     no formato "(NN) NNNNN-NNNN" (o do checkout) ..... 56
--     em digito puro ................................... 22
--     outros formatos ..................................  5
--
--   E o checkout e o UNICO caminho que grava telefone hoje (`formatWhatsApp`,
--   CheckoutView.tsx:180), entao TODO pedido novo nasce mascarado. A lojista
--   copia "34988887777" do WhatsApp, cola na busca, e o `ILIKE '%34988887777%'`
--   nao casa "(34) 98888-7777".
--
--   CONTROLE, na mesma rodada: `customer_name` preenchido em 83 de 83, e a busca
--   por nome acha. O defeito e' especifico do telefone.
--
-- 🔴 ESTA MIGRATION SUBSTITUI UMA ABORDAGEM ANTERIOR, E O MOTIVO IMPORTA.
--
-- A primeira versao deste conserto atacava a ESCRITA: punha `customer_phone` no
-- INSERT das duas RPCs de criar pedido e fazia backfill dos 81 pedidos cuja
-- coluna estava nula. Estava correta e provada (26/26), mas era a metade errada
-- do problema:
--
--   - nao resolvia o caso real -- o telefone continuaria mascarado na coluna, e
--     colar o numero inteiro continuaria sem achar;
--   - mexia nas DUAS RPCs do caminho do dinheiro, que sao a peca mais tocada e
--     mais cara de errar deste repositorio;
--   - exigia um `UPDATE` de backfill que o rollback automatico nao cobre;
--   - e obrigava a provar uma invariante de AUTENTICACAO (o `coalesce` do OTP),
--     porque preencher a coluna muda o primeiro argumento dele.
--
--   O que decidiu: `customer_phone` NAO E LIDA POR NINGUEM fora do banco --
--   `grep` em `src/` devolve so declaracao de tipo, e em `supabase/functions/`
--   devolve vazio. Os unicos leitores sao esta funcao de busca e o OTP, e o OTP
--   ja usa `coalesce(customer_phone, customer_data->>'whatsapp', '')`. Logo,
--   consertar AQUI resolve os 83 pedidos existentes, os futuros, e ainda os
--   criados pela RPC legada -- sem tocar em uma linha do caminho do dinheiro e
--   sem `UPDATE` nenhum.
--
--   A correcao menor e a que nao abre a calculadora. A anterior foi descartada
--   inteira, nao adaptada.
--
-- 🔴 A GUARDA `v_search_digitos <> ''` E A PARTE QUE O CONSERTO INGENUO ERRA.
-- Normalizar so os dois lados faria o termo "Maria" virar '', e `LIKE '%%'`
-- casaria TODOS os pedidos pela clausula do telefone -- o painel mostraria a
-- lista inteira para qualquer busca por texto. A prova tem caso proprio para
-- isso, e a mutacao que tira a guarda derruba exatamente ele.
--
-- 🔴 SAO DUAS CLAUSULAS, uma na consulta de CONTAGEM e outra na de DADOS.
-- Consertar so uma faria o painel dizer "12 resultados" e listar 3.
--
-- 🔴 CREATE OR REPLACE E SUBSTITUICAO: atributo que nao for repetido por
-- extenso SOME EM SILENCIO. Esta funcao tem `SET search_path TO 'public',
-- 'extensions'` -- DIFERENTE das RPCs de pedido, que usam so 'public'. Ela
-- depende de `unaccent`, que vive em `extensions`; se o search_path encolher, a
-- busca por nome quebra com "function unaccent(text) does not exist". O corpo
-- abaixo saiu de `pg_get_functiondef()` do banco vivo, que emite os atributos
-- por extenso, e foi conferido: 1 definicao viva com esse nome, `prosecdef`
-- true, `proconfig` = ["search_path=public, extensions"].
--
-- SEM BEGIN/COMMIT: com eles o ROLLBACK do script de prova vira no-op e a
-- mudanca fica gravada mesmo assim.
--
-- Prova: scripts/db-prove-busca-por-telefone.cjs

CREATE OR REPLACE FUNCTION public.get_admin_orders_paged(p_search text DEFAULT ''::text, p_status text DEFAULT 'all'::text, p_start_date text DEFAULT ''::text, p_end_date text DEFAULT ''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
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
            -- 🔴 A GUARDA `v_search_digitos <> ''` NAO E DETALHE: sem ela,
            -- buscar por um NOME (que nao tem digito) reduz o termo a ''
            -- e `LIKE '%%'` casaria TODOS os pedidos por esta clausula --
            -- o painel passaria a mostrar a lista inteira para qualquer
            -- texto. E' o defeito que o conserto ingenuo introduz.
            --
            -- O `coalesce` com o jsonb e o MESMO de
            -- `generate_order_otp_v1`/`v2`: pedido gravado pela RPC legada
            -- (que nunca preencheu a coluna) tambem passa a ser achavel.
            v_search_digitos <> ''
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
            -- 🔴 A GUARDA `v_search_digitos <> ''` NAO E DETALHE: sem ela,
            -- buscar por um NOME (que nao tem digito) reduz o termo a ''
            -- e `LIKE '%%'` casaria TODOS os pedidos por esta clausula --
            -- o painel passaria a mostrar a lista inteira para qualquer
            -- texto. E' o defeito que o conserto ingenuo introduz.
            --
            -- O `coalesce` com o jsonb e o MESMO de
            -- `generate_order_otp_v1`/`v2`: pedido gravado pela RPC legada
            -- (que nunca preencheu a coluna) tambem passa a ser achavel.
            v_search_digitos <> ''
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
$function$
