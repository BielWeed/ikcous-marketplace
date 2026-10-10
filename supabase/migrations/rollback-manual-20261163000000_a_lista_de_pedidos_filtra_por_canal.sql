-- ============================================================================
-- ROLLBACK MANUAL da 20261163000000 — a lista de pedidos filtra por canal
-- (LOTE C1 da venda presencial/PDV, tarefa C1.4)
-- ============================================================================
--
-- O QUE ESTE ARQUIVO DESFAZ: devolve `public.get_admin_orders_paged` ao estado
-- exato de antes da 20261163000000 — a sobrecarga de 7 argumentos, sem
-- `p_canal`, com o corpo da
-- 20261068000000_a_busca_de_pedidos_para_de_varrer_o_banco.sql:121-338
-- COPIADO BYTE A BYTE (assinatura, comentários longos do laudo e todos os
-- filtros). Nada aqui é digitado de novo: o corpo tem de ser o mesmo texto,
-- senão "voltar atrás" viraria uma terceira versão da função.
--
-- A ORDEM É INVERSA À DA IDA:
--   1. `DROP FUNCTION IF EXISTS public.get_admin_orders_paged(text, text,
--      text, text, integer, integer, text, text);` — derruba a de 8
--      argumentos. Sem este DROP, o `CREATE OR REPLACE` do passo 2 criaria a
--      de 7 AO LADO da de 8 (sobrecarga é por assinatura) e toda chamada
--      nomeada do painel passaria a explodir com «function
--      get_admin_orders_paged(...) is not unique» — o defeito de
--      20261034000000:6-13, agora ao contrário.
--   2. `CREATE OR REPLACE FUNCTION` da assinatura de 7 argumentos, corpo
--      verbatim da 20261068000000.
--   3. `REVOKE`/`GRANT` REFEITOS com a assinatura de 7 argumentos. O DROP do
--      passo 1 leva o ACL da de 8, e a função recriada no passo 2 é OUTRA
--      entrada do catálogo: nasce com o default do Postgres (EXECUTE para
--      PUBLIC) e sem nenhum grant herdado. Sem este passo, `authenticated`
--      ficaria sem EXECUTE e o painel inteiro perderia a lista de pedidos —
--      o job "Código x banco" do CI acusaria a RPC como INALCANÇÁVEL
--      (scripts/db-check-objetos-do-codigo.mjs:20-27).
--
-- O QUE ELE NÃO TOCA, DE PROPÓSITO:
--   - `marketplace_orders.canal`, a CHECK e o índice parcial de pedidos
--     presenciais: são da 20261160000000 (C1.1) e têm o rollback DELES.
--     Derrubá-los aqui quebraria C1.2 e C1.3.
--   - Os índices GIN da 20261068000000:96-112 e a função `public.f_unaccent`:
--     a migration de ida não encostou neles.
--   - Nenhuma linha de `marketplace_orders` é lida, escrita ou apagada. Os
--     pedidos com `canal = 'presencial'` continuam lá; o que se perde é só a
--     capacidade de FILTRAR por canal na lista.
--
-- EFEITO COLATERAL ESPERADO (é a razão de o rollback ser "manual"): qualquer
-- tela que já chame a RPC com `p_canal` passa a receber «function
-- public.get_admin_orders_paged(...) does not exist» (SQLSTATE 42883). Na
-- ordem do lote C1 isso não acontece — C1 inteiro entra ANTES de qualquer
-- chamada em `src/` —, mas rodar este rollback DEPOIS de C4 estar no ar deixa
-- o chip "Balcão" do painel sem servidor.
--
-- IDEMPOTÊNCIA: `DROP FUNCTION IF EXISTS` + `CREATE OR REPLACE FUNCTION` +
-- `REVOKE`/`GRANT` declarativos — rodar duas vezes dá o mesmo estado. A
-- assinatura completa de 8 tipos no DROP é obrigatória pelo mesmo motivo da
-- ida (com mais de uma sobrecarga viva, o nome sozinho erra ou derruba a
-- errada).
--
-- COMO APLICAR: `node scripts/db-apply.cjs <este arquivo>` ou `psql -1`. Sem
-- `BEGIN`/`COMMIT` de nível superior neste arquivo (regra da casa).
--
-- VERIFICAÇÃO pós-rollback:
--   1. SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p
--        JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'get_admin_orders_paged';
--      -- esperado: UMA linha, text, text, text, text, integer, integer, text.
--   2. SELECT get_admin_orders_paged(p_search=>'', p_status=>'all',
--        p_start_date=>'', p_end_date=>'', p_page=>0, p_page_size=>10,
--        p_payment_status=>'all') -> 'total_count';
--      -- esperado: o total de sempre, sem «is not unique».
--   3. SELECT has_function_privilege('authenticated',
--        'public.get_admin_orders_paged(text, text, text, text, integer, integer, text)',
--        'EXECUTE');
--      -- esperado: true (e false para 'anon').
-- ============================================================================

-- 1. A de 8 argumentos morre primeiro (senão as duas ficariam vivas).
DROP FUNCTION IF EXISTS public.get_admin_orders_paged(text, text, text, text, integer, integer, text, text);

-- 2. A de 7 argumentos volta, com o corpo verbatim da 20261068000000:121-338.
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

-- 3. Grants REFEITOS para a assinatura de 7 argumentos: a função recriada é
--    outra entrada do catálogo e nasce com EXECUTE para PUBLIC.
REVOKE ALL ON FUNCTION public.get_admin_orders_paged(text, text, text, text, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_orders_paged(text, text, text, text, integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_orders_paged(text, text, text, text, integer, integer, text) TO service_role;
