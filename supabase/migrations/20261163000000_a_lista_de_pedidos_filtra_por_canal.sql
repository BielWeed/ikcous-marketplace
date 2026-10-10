-- ============================================================================
-- Migration 20261163000000 — a lista de pedidos filtra por canal (LOTE C1 da
-- venda presencial/PDV, tarefa C1.4; desenho em
-- docs/superpowers/plans/2026-09-15-super-atualizacao-do-app.md §5.2)
-- ============================================================================
--
-- O DEFEITO QUE ESTA MIGRATION FECHA: desde a 20261160000000 (C1.1) todo
-- pedido carrega `canal` ('online' ou 'presencial'), e a venda de balcão
-- registrada pela 20261162000000 (C1.3) nasce 'presencial'. Só que a lista do
-- painel — `get_admin_orders_paged` — não sabe filtrar por isso: o chip
-- "Balcão" teria de buscar a página inteira e cortar em memória, que é
-- EXATAMENTE o achado 10 do laudo de 29/08 (o filtro de pagamento que só
-- existia na tela e "dormia" enquanto o resultado cabia numa página —
-- comentário vivo em 20261068000000:154-159). Falta o FILTRO, e só ele.
--
-- O QUE ESTA MIGRATION FAZ, NA ORDEM:
--   1. `DROP FUNCTION IF EXISTS public.get_admin_orders_paged(text, text,
--      text, text, integer, integer, text);` — derruba a sobrecarga de 7
--      argumentos ANTES de criar a de 8. NÃO é zelo: com as duas vivas ao
--      mesmo tempo, toda chamada com os 7 parâmetros NOMEADOS casa nas duas e
--      o Postgres recusa com
--        ERROR: function get_admin_orders_paged(...) is not unique
--      É exatamente assim que o painel chama hoje, em src/hooks/useOrders.ts:
--      a lista de pedidos passa os 7 nomeados e a de cancelados passa 6 (sem
--      número de linha de propósito — aquele arquivo muda de tamanho a cada
--      PR).
--      Foi letra por letra o defeito de
--      20261034000000_drop_overload_velho_get_admin_orders_paged.sql:6-13 (a
--      6-args deixada viva ao lado da 7-args), que acendeu o aviso amarelo
--      "lista incompleta" numa loja com ZERO pedidos. Com `p_canal text
--      DEFAULT 'all'`, as chamadas de 6 e de 7 argumentos passam a resolver na
--      nova com o MESMO comportamento de antes ('all' = sem filtro de canal),
--      pelo mesmo raciocínio registrado em 20261034000000:15-19.
--   2. `CREATE OR REPLACE FUNCTION public.get_admin_orders_paged(...)` com os
--      7 parâmetros de antes (mesmos nomes, tipos, ordem e defaults) + o
--      oitavo, `p_canal text DEFAULT 'all'::text`, no FIM. O corpo é o da
--      20261068000000:126-337 COPIADO, comentários longos inclusive (eles são
--      a memória dos achados do laudo — o limiar de 4 dígitos do telefone, o
--      coalesce do WhatsApp em jsonb, a regra de 'sem_cobranca'), com UMA
--      mudança, repetida nos DOIS lugares onde os filtros aparecem: logo
--      depois do bloco de `p_payment_status`, na CONTAGEM (:158-162) e na
--      CONSULTA PAGINADA (:269-273), entra
--        AND (p_canal = 'all' OR o.canal = p_canal)
--      Nos dois, não num só: filtrar apenas a página paginada faria o
--      `total_count` mentir e o painel acenderia o aviso de lista incompleta.
--   3. O RETORNO NÃO MUDA DE FORMA. A função devolve `o.*`
--      (20261068000000:225) embrulhado em `jsonb_build_object('data', ...,
--      'total_count', ...)`, então `canal` já vem sozinho no JSON desde que a
--      coluna existe (C1.1) — não há lista de colunas para mexer, não vira
--      RETURNS TABLE, e nenhum consumidor de hoje precisa mudar para
--      continuar funcionando.
--   4. `REVOKE ALL` da assinatura de 8 argumentos para PUBLIC e anon, e
--      `GRANT EXECUTE` para `authenticated` e `service_role`. É o passo que
--      mais se esquece: o `DROP` derruba o ACL e uma função nova nasce com
--      EXECUTE para PUBLIC (default do Postgres). MEDIDO: esta função NÃO está
--      na lista curada de REVOKEs de
--      20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql nem de
--      20261091000000 (grep pelo nome: zero resultado nos dois) — ou seja, o
--      ACL vivo dela é o default, e quem protege de verdade é o gate
--      `IF NOT public.is_admin()` do corpo (20261068000000:135-137). O
--      DROP+CREATE sozinho já reporia esse mesmo estado; os grants explícitos
--      são um APERTO DELIBERADO, não acidente: `anon` perde um EXECUTE que
--      nunca passava do gate, e fecha-se aqui o resíduo de PUBLIC que a
--      20261090500000 teve de limpar em massa nas outras 58 funções.
--      `authenticated` com EXECUTE é OBRIGATÓRIO: sem ele o job "Código x
--      banco" do CI acusa INALCANÇÁVEL para a RPC que o painel já chama hoje
--      (scripts/db-check-objetos-do-codigo.mjs:20-27) — seria regressão do
--      painel inteiro, não só do PDV.
--
-- DADOS EXISTENTES: nenhuma linha é lida, comparada ou reescrita. Só o
-- catálogo de funções muda. Chamada sem `p_canal` (as de 6 e 7 argumentos que
-- o painel faz hoje) devolve exatamente o mesmo conjunto de antes, porque o
-- default 'all' desliga o predicado novo.
--
-- IDEMPOTÊNCIA: `DROP FUNCTION IF EXISTS` seguido de `CREATE OR REPLACE
-- FUNCTION`, mais `REVOKE`/`GRANT`, que são declarativos — reaplicar o arquivo
-- deixa o mesmo estado. O `DROP` nomeia a assinatura de 7 tipos por inteiro:
-- sem os tipos, com duas sobrecargas vivas o comando erraria com «function
-- name is not unique», e com a assinatura errada derrubaria a função errada.
--
-- FORA DO ESCOPO: aplicar de verdade no banco (`node scripts/db-apply.cjs`,
-- fora do PR); passar `p_canal` e ler `canal` no front (src/hooks/useOrders.ts
-- e src/lib/mappers.ts são trabalho de C4); a tela do PDV (C3); os índices GIN
-- de 20261068000000:96-112, que continuam como estão; a própria
-- 20261068000000, que NÃO é editada (correção entra como arquivo novo).
--
-- COMO APLICAR: exclusivamente em transação externa, via
-- `node scripts/db-apply.cjs supabase/migrations/20261163000000_a_lista_de_pedidos_filtra_por_canal.sql`
-- ou `psql -1`. Sem `BEGIN`/`COMMIT` de nível superior neste arquivo (regra da
-- casa).
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (rodar contra o banco, como admin):
--
--   1. SELECT count(*)::int AS sobrecargas FROM pg_proc p
--        JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'get_admin_orders_paged';
--      -- esperado: 1 (a de 8 argumentos; a de 7 morreu no passo 1).
--
--   2. SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p
--        JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'get_admin_orders_paged';
--      -- esperado: text, text, text, text, integer, integer, text, text.
--
--   3. SELECT get_admin_orders_paged(p_search=>'', p_status=>'all',
--        p_start_date=>'', p_end_date=>'', p_page=>0, p_page_size=>10,
--        p_payment_status=>'all') -> 'total_count';
--      -- esperado: o total de sempre, SEM «is not unique» (é a chamada de 7
--      -- parâmetros nomeados que o painel faz hoje).
--
--   4. SELECT get_admin_orders_paged(p_page_size=>200, p_canal=>'presencial')
--        -> 'total_count';
--      -- esperado: só as vendas de balcão; e
--      --   ... -> 'data' -> 0 ->> 'canal' = 'presencial'.
--
--   5. SELECT get_admin_orders_paged(p_page_size=>200, p_canal=>'online')
--        -> 'total_count';
--      -- esperado: o complemento de (4) — o total de (4) somado ao de (5)
--      -- tem de dar o total de (3), a chamada sem filtro de canal.
--
--   6. SELECT has_function_privilege('anon',
--        'public.get_admin_orders_paged(text, text, text, text, integer, integer, text, text)',
--        'EXECUTE');
--      -- esperado: false. Com 'authenticated' e 'service_role': true.
--
-- ROLLBACK: rollback-manual-20261163000000_a_lista_de_pedidos_filtra_por_canal.sql
-- — derruba a de 8 argumentos e recria a de 7 com o corpo verbatim da
-- 20261068000000, refazendo os grants daquela assinatura.
-- ============================================================================

-- 1. A sobrecarga de 7 argumentos MORRE antes de a de 8 nascer (ver item 1 do
--    cabeçalho: duas sobrecargas vivas = «is not unique» em toda chamada
--    nomeada do painel).
DROP FUNCTION IF EXISTS public.get_admin_orders_paged(text, text, text, text, integer, integer, text);

-- 2. Corpo COPIADO da 20261068000000:126-337 (os comentários longos são a
--    memória dos achados do laudo de 29/08 — não reescrever), com o filtro de
--    canal acrescentado na contagem e na consulta paginada.
CREATE OR REPLACE FUNCTION public.get_admin_orders_paged(p_search text DEFAULT ''::text, p_status text DEFAULT 'all'::text, p_start_date text DEFAULT ''::text, p_end_date text DEFAULT ''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_payment_status text DEFAULT 'all'::text, p_canal text DEFAULT 'all'::text)
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
      -- Chip "Balcão" da lista do painel (seção 5.2 do plano): filtra pelo
      -- canal da venda; 'all' é o comportamento de sempre (nada filtrado).
      AND (p_canal = 'all' OR o.canal = p_canal)
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
      -- Chip "Balcão" da lista do painel (seção 5.2 do plano): filtra pelo
      -- canal da venda; 'all' é o comportamento de sempre (nada filtrado).
      AND (p_canal = 'all' OR o.canal = p_canal)
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

-- 3. O DROP do passo 1 levou o ACL junto e função nova nasce com EXECUTE para
--    PUBLIC (default do Postgres). Aperto deliberado: anon perde um EXECUTE
--    que nunca passava do gate de admin; authenticated NÃO pode perder o dele
--    (o painel inteiro chama esta RPC, e o job "Código x banco" do CI reprova
--    o PR se ela ficar inalcançável).
REVOKE ALL ON FUNCTION public.get_admin_orders_paged(text, text, text, text, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_orders_paged(text, text, text, text, integer, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_orders_paged(text, text, text, text, integer, integer, text, text) TO service_role;
