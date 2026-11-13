-- Rollback manual da 20261399980000. Devolve get_admin_products_paged, get_admin_orders_paged e get_admin_orders_cancelados_recentes
-- aos corpos vigentes (os da 20261399200000, 20261399900000 e 20261380000000) byte a byte (LF), mantendo OID, dono, atributos e ACL;
-- nao toca em dados.
-- ATENCAO: reabre o defeito (registros com a mesma data voltam a sair em ordem instavel entre as paginas das tres listas: repetem um
-- e escondem outro; a exportacao CSV de Pedidos volta a poder perder linhas). O front nao precisa voltar.
-- O pre-voo exige, nas TRES, o corpo da 20261399980000 (md5 get_admin_products_paged 0f153b653338f6570da399493093cfae; get_admin_orders_paged b404a8397a6490c86fb192d85fd5b6c9; get_admin_orders_cancelados_recentes 80ec13f92e224b21d5308a063e88fb6e):
-- segundo rollback, estado misto ou sucessora desconhecida recusa sem escrever.
-- Depois dele os corpos sao os vigentes (md5 346063e900b8b7b63dfbeffe5070eedc, bf08545275eaa451a65e15feceb0ed8d, 9567454f17698f3f0624cca0b06458cd), que e o que o rollback
-- de cada uma das tres migrations anteriores exige.
-- Sem controle de transacao: o aplicador fornece a transacao inteira.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261399980000$
DECLARE
  r record;
  v_hash text;
  v_atributos jsonb;
BEGIN
  FOR r IN
    SELECT e.chave, e.assinatura, e.hash_vigente, e.hash_desta, a.argumentos,
           substring(e.assinatura from 'public\.([a-z_0-9]+)\(') AS nome
      FROM (VALUES
        ('produtos', 'public.get_admin_products_paged(text,text,text,text,integer,integer)', '346063e900b8b7b63dfbeffe5070eedc', '0f153b653338f6570da399493093cfae'),
        ('pedidos', 'public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)', 'bf08545275eaa451a65e15feceb0ed8d', 'b404a8397a6490c86fb192d85fd5b6c9'),
        ('cancelados', 'public.get_admin_orders_cancelados_recentes(integer,integer,integer)', '9567454f17698f3f0624cca0b06458cd', '80ec13f92e224b21d5308a063e88fb6e')
      ) AS e(chave, assinatura, hash_vigente, hash_desta)
      JOIN (VALUES
        ('produtos', 'p_search text, p_category text, p_status text, p_stock text, p_page integer, p_page_size integer'),
        ('pedidos', 'p_search text, p_status text, p_start_date text, p_end_date text, p_page integer, p_page_size integer, p_payment_status text, p_canal text'),
        ('cancelados', 'p_dias integer, p_page integer, p_page_size integer')
      ) AS a(chave, argumentos) ON a.chave = e.chave
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos FROM pg_proc p
     WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) nao e o corpo desta migration; revise antes de desfazer.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = to_regprocedure(r.assinatura)
         AND p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
         AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
         AND l.lanname = 'plpgsql' AND p.prorettype = 'jsonb'::regtype
         AND pg_get_function_identity_arguments(p.oid) = r.argumentos
         AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))
         AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = r.nome) = 1
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem assinatura, atributos, dono ou permissoes diferentes dos esperados.', r.nome;
    END IF;
    -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
    PERFORM set_config('ikcous.listas3998_' || r.chave, v_atributos::text, true);
  END LOOP;
END $preflight_rollback_20261399980000$;

CREATE OR REPLACE FUNCTION public.get_admin_products_paged(p_search text DEFAULT ''::text, p_category text DEFAULT 'all'::text, p_status text DEFAULT 'all'::text, p_stock text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
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
    v_padroes TEXT[];
BEGIN
    -- Authorization check
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

    -- Palavra por palavra: cada palavra do texto vira um padrao de ILIKE sem acento, com % e _ e a barra invertida escapados
    -- (valem como as letras que sao). Texto vazio, so de espacos ou NULL: nenhum padrao, nenhum filtro.
    SELECT COALESCE(array_agg('%' || replace(replace(replace(unaccent(w.palavra), chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_') || '%'), '{}'::TEXT[])
      INTO v_padroes
      FROM regexp_split_to_table(COALESCE(v_clean_search, ''), '[[:space:]]+') AS w(palavra)
     WHERE w.palavra <> '';

    -- Compute total count with filters (before pagination)
    SELECT COUNT(p.id) INTO v_total_count
    FROM public.produtos p
    WHERE p.deleted_at IS NULL
      AND (p_category = 'all' OR p.categoria = p_category)
      AND (p_status = 'all' OR (p_status = 'active' AND p.ativo = TRUE) OR (p_status = 'inactive' AND p.ativo = FALSE))
      AND (p_stock = 'all' OR (p_stock = 'low' AND (CASE WHEN EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) THEN (SELECT COALESCE(sum(COALESCE(pv.stock_increment, 0)), 0) FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) ELSE p.estoque END) <= COALESCE(p.estoque_minimo, 5)))
      AND (
        cardinality(v_padroes) = 0 OR
        -- Codigo de barras: IGUALDADE do texto inteiro (um EAN pode ser prefixo de outro), do produto ou de uma variacao ATIVA.
        p.codigo_barras = v_clean_search OR
        EXISTS (
          SELECT 1 FROM public.product_variants vc
           WHERE vc.product_id = p.id AND vc.active AND vc.codigo_barras = v_clean_search
        ) OR
        -- TODAS as palavras no texto junto do produto: nome, codigo e SKU, nome e valor das variacoes ATIVAS (montado uma vez por produto).
        EXISTS (
          SELECT 1
            FROM (SELECT unaccent(concat_ws(' ', p.nome, p.codigo, (SELECT string_agg(concat_ws(' ', vt.sku, vt.name, vt.value), ' ') FROM public.product_variants vt WHERE vt.product_id = p.id AND vt.active))) AS texto OFFSET 0) t
           WHERE NOT EXISTS (SELECT 1 FROM unnest(v_padroes) AS w(padrao) WHERE t.texto NOT ILIKE w.padrao)
        )
      );

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            p.*,
            (
                SELECT COALESCE(
                    jsonb_agg(to_jsonb(v.*)),
                    '[]'::JSONB
                )
                FROM public.product_variants v
                WHERE v.product_id = p.id
            ) AS product_variants
        FROM public.produtos p
        WHERE p.deleted_at IS NULL
          AND (p_category = 'all' OR p.categoria = p_category)
          AND (p_status = 'all' OR (p_status = 'active' AND p.ativo = TRUE) OR (p_status = 'inactive' AND p.ativo = FALSE))
          AND (p_stock = 'all' OR (p_stock = 'low' AND (CASE WHEN EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) THEN (SELECT COALESCE(sum(COALESCE(pv.stock_increment, 0)), 0) FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) ELSE p.estoque END) <= COALESCE(p.estoque_minimo, 5)))
          AND (
            cardinality(v_padroes) = 0 OR
            -- Codigo de barras: IGUALDADE do texto inteiro (um EAN pode ser prefixo de outro), do produto ou de uma variacao ATIVA.
            p.codigo_barras = v_clean_search OR
            EXISTS (
              SELECT 1 FROM public.product_variants vc
               WHERE vc.product_id = p.id AND vc.active AND vc.codigo_barras = v_clean_search
            ) OR
            -- TODAS as palavras no texto junto do produto: nome, codigo e SKU, nome e valor das variacoes ATIVAS (montado uma vez por produto).
            EXISTS (
              SELECT 1
                FROM (SELECT unaccent(concat_ws(' ', p.nome, p.codigo, (SELECT string_agg(concat_ws(' ', vt.sku, vt.name, vt.value), ' ') FROM public.product_variants vt WHERE vt.product_id = p.id AND vt.active))) AS texto OFFSET 0) t
               WHERE NOT EXISTS (SELECT 1 FROM unnest(v_padroes) AS w(padrao) WHERE t.texto NOT ILIKE w.padrao)
            )
          )
        ORDER BY p.data_cadastro DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_orders_paged(p_search text DEFAULT ''::text, p_status text DEFAULT 'all'::text, p_start_date text DEFAULT ''::text, p_end_date text DEFAULT ''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_payment_status text DEFAULT 'all'::text, p_canal text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
    v_search_digitos TEXT;
    v_parece_telefone BOOLEAN;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);
    -- So os digitos do que a pessoa digitou. Serve para casar telefone
    -- independente de mascara -- ver a clausula do telefone abaixo.
    v_search_digitos := regexp_replace(v_clean_search, '[^0-9]', '', 'g');
    -- Com 12 ou 13 digitos que comecam por 55 (o +55 do Brasil colado do WhatsApp), o 55 sai antes de
    -- comparar: o checkout e o balcao guardam o telefone sem o 55 ("(34) 98888-7777"), a mesma regra da busca
    -- de clientes (20261230000000) e da do CRM (20261392100000). Um telefone guardado COM o 55 continua casando
    -- (a comparacao e 'contem'). O DDD 55 (Santa Maria/RS) com 11 digitos nao perde o 55: nao entra neste corte.
    IF length(v_search_digitos) IN (12, 13) AND left(v_search_digitos, 2) = '55' THEN
        v_search_digitos := substr(v_search_digitos, 3);
    END IF;
    -- A busca so e' de TELEFONE quando o que foi digitado parece um telefone:
    -- digitos e os enfeites de um numero ("+", "(", ")", espaco, "-", "."),
    -- nada de letra. O numero do pedido que a loja mostra ("#3884BE": os 6
    -- ultimos caracteres do id) mistura letra e digito; extrair so os digitos
    -- dele ("3884") mandava a busca para o telefone de OUTRA pessoa. Um nome
    -- com numero junto ("Maria 3884") tambem nao e' telefone.
    v_parece_telefone := v_clean_search ~ '^[+]?[0-9() .-]+$';

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
            --
            -- E SO' QUANDO A BUSCA PARECE TELEFONE (v_parece_telefone, acima):
            -- com letra no termo, os digitos que sobram dele nao sao um
            -- telefone -- ver o numero do pedido ("3884BE") no comeco.
            v_parece_telefone AND length(v_search_digitos) >= 4
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
            --
            -- E SO' QUANDO A BUSCA PARECE TELEFONE (v_parece_telefone, acima):
            -- com letra no termo, os digitos que sobram dele nao sao um
            -- telefone -- ver o numero do pedido ("3884BE") no comeco.
            v_parece_telefone AND length(v_search_digitos) >= 4
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
        -- O pedido que o NUMERO digitado nomeia vem primeiro: os 6 ultimos
        -- caracteres do id, sem caixa (o "#3884BE" do painel, de
        -- numeroDoPedido). Um numero que e' so' digito (um em cada 17
        -- pedidos) tambem casa telefone, e o telefone nao pode empurrar o
        -- pedido para fora da primeira pagina. Sem busca, a ordem e' a de
        -- sempre (o CASE e' 1 para todos).
        ORDER BY
            CASE
                WHEN v_clean_search <> ''
                     AND upper(right(o.id::TEXT, 6)) = upper(v_clean_search)
                THEN 0
                ELSE 1
            END,
            o.created_at DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_orders_cancelados_recentes(p_dias integer DEFAULT 90, p_page integer DEFAULT 0, p_page_size integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_total_count BIGINT;
    v_fora_da_janela BIGINT;
    v_data JSONB;
    v_offset INTEGER;
BEGIN
    -- Authorization check (mesmo gate da get_admin_orders_paged).
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;

    -- Contagem, numa passada só: dentro da janela (é o total que o laço do
    -- front persegue) e fora dela (o número que impede o recorte de
    -- mentir). p_dias NULL = sem janela: dentro = todos, fora = 0.
    --
    -- "Fora" conta SÓ o cancelado antigo que ainda tem PENDÊNCIA REAL, pela
    -- mesma regra dos dois baldes do painel (AdminOrdersView.tsx):
    --   (a) DINHEIRO a devolver: o pagamento ENTROU (pago, pago_apos_expirar
    --       ou recebido_na_entrega) e ainda sobra valor depois de descontar o
    --       reembolso manual de devolução concluída e o estorno já confirmado
    --       (a mesma conta de valorDevolverAgora, em src/lib);
    --   (b) MERCADORIA a voltar: o pedido foi enviado e cancelado depois de
    --       sair, e o produto ainda não foi confirmado de volta.
    -- Cancelado antigo sem pagamento e sem envio, ou já devolvido e com o
    -- produto de volta, não tem o que fazer e não entra. A conta pode sobrar
    -- (nunca faltar): nada é descontado pelo estorno "em andamento", que o
    -- painel também mantém na lista. O total de DENTRO da janela não muda.
    SELECT
        COUNT(*) FILTER (
          WHERE p_dias IS NULL
             OR cancelado_em >= now() - make_interval(days => p_dias)
        ),
        COUNT(*) FILTER (
          WHERE p_dias IS NOT NULL
            AND cancelado_em < now() - make_interval(days => p_dias)
            AND pendente
        )
      INTO v_total_count, v_fora_da_janela
      FROM (
        SELECT o.id,
               COALESCE(h.cancelado_em, o.updated_at) AS cancelado_em,
               COALESCE(
                 (o.cancelled_after_shipping IS TRUE AND o.returned_to_seller_at IS NULL)
                 OR CASE
                      WHEN o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
                        THEN o.total
                             - COALESCE((SELECT sum(d.valor_reembolso)
                                           FROM public.devolucoes d
                                          WHERE d.order_id = o.id
                                            AND d.status = 'concluida'
                                            AND d.reembolso_manual), 0)
                             - COALESCE(o.valor_estornado, 0) > 0
                      ELSE FALSE
                    END,
                 FALSE) AS pendente
          FROM public.marketplace_orders o
          LEFT JOIN LATERAL (
            SELECT MAX(hi.created_at) AS cancelado_em
              FROM public.marketplace_order_history hi
             WHERE hi.order_id = o.id
               AND hi.new_status = 'cancelled'
          ) h ON TRUE
         WHERE o.status = 'cancelled'
      ) c;

    -- Linhas enxutas: as 23 colunas que o mapper e o painel leem, mais a
    -- coluna nova do achado 1 (rodada 2), na ordem de atenção do
    -- cancelamento (mais recente primeiro). Nenhum item, nenhum endereço.
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT jsonb_build_object(
            'id', c.id,
            'user_id', c.user_id,
            'customer_name', c.customer_name,
            'customer_data', c.customer_data,
            'total', c.total,
            'subtotal', c.subtotal,
            'shipping', c.shipping,
            'discount', c.discount,
            'payment_method', c.payment_method,
            'payment_status', c.payment_status,
            'status', c.status,
            'notes', c.notes,
            'coupon_code', c.coupon_code,
            'tracking_code', c.tracking_code,
            'cancelled_after_shipping', c.cancelled_after_shipping,
            'returned_to_seller_at', c.returned_to_seller_at,
            'pagamento_recebido_em', c.pagamento_recebido_em,
            'pagamento_recebido_por', c.pagamento_recebido_por,
            'canal', c.canal,
            'vendedor_id', c.vendedor_id,
            'created_at', c.created_at,
            'updated_at', c.updated_at,
            'cancelado_em', c.cancelado_em,
            'valor_devolvido_por_devolucao', c.valor_devolvido_por_devolucao,
            'valor_estornado', c.valor_estornado
        ) AS t
        FROM (
            SELECT o.id,
                   o.user_id,
                   o.customer_name,
                   o.customer_data,
                   o.total,
                   o.subtotal,
                   o.shipping,
                   o.discount,
                   o.payment_method,
                   o.payment_status,
                   o.status,
                   o.notes,
                   o.coupon_code,
                   o.tracking_code,
                   o.cancelled_after_shipping,
                   o.returned_to_seller_at,
                   o.pagamento_recebido_em,
                   o.pagamento_recebido_por,
                   o.canal,
                   o.vendedor_id,
                   o.created_at,
                   o.updated_at,
                   COALESCE(h.cancelado_em, o.updated_at) AS cancelado_em,
                   COALESCE((SELECT sum(d.valor_reembolso) FROM public.devolucoes d
                              WHERE d.order_id = o.id AND d.status = 'concluida' AND d.reembolso_manual), 0)
                     AS valor_devolvido_por_devolucao,
                   -- Achado A4 (revisão 26/09/2026, rodada 3): o "Devolver
                   -- agora" também precisa saber o que já saiu pelo ledger
                   -- CONFIRMADO (order_refunds concluído, coluna somada só em
                   -- concluir_estorno) — sem isto, um estorno parcial já
                   -- pago pelo MP não descontava do valor que falta.
                   o.valor_estornado
              FROM public.marketplace_orders o
              LEFT JOIN LATERAL (
                SELECT MAX(hi.created_at) AS cancelado_em
                  FROM public.marketplace_order_history hi
                 WHERE hi.order_id = o.id
                   AND hi.new_status = 'cancelled'
              ) h ON TRUE
             WHERE o.status = 'cancelled'
               AND (p_dias IS NULL OR COALESCE(h.cancelado_em, o.updated_at) >= now() - make_interval(days => p_dias))
             ORDER BY COALESCE(h.cancelado_em, o.updated_at) DESC, o.created_at DESC
             LIMIT p_page_size
            OFFSET v_offset
        ) c
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'fora_da_janela', v_fora_da_janela
    );
END;
$$;

DO $conferencia_rollback_20261399980000$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('produtos', 'public.get_admin_products_paged(text,text,text,text,integer,integer)', '346063e900b8b7b63dfbeffe5070eedc'),
    ('pedidos', 'public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)', 'bf08545275eaa451a65e15feceb0ed8d'),
    ('cancelados', 'public.get_admin_orders_cancelados_recentes(integer,integer,integer)', '9567454f17698f3f0624cca0b06458cd')
  ) AS esperado(chave, assinatura, hash)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)
        AND md5(replace(p.prosrc, E'\r', '')) = r.hash
        AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.listas3998_' || r.chave)::jsonb
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia rollback_20261399980000 falhou em % (corpo ou atributos alterados).', r.chave;
    END IF;
  END LOOP;
END $conferencia_rollback_20261399980000$;

NOTIFY pgrst, 'reload schema';
