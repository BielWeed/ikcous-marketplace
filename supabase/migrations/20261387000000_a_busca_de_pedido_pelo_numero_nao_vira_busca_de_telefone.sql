-- A BUSCA DE PEDIDO PELO NUMERO NAO VIRA BUSCA DE TELEFONE (permissao + dado de cliente; 26/10/2026).
--
-- DEFEITO (o que a lojista ve): ela copia o numero do pedido que o painel mostra ("#3884BE": os 6
-- ultimos caracteres do id, em maiusculas) e cola na busca da tela Pedidos. Alem do pedido, a lista
-- traz o pedido de OUTRA pessoa cujo telefone tem "3884" no meio -- e, como a lista vem do mais
-- novo para o mais velho, o pedido procurado pode ficar atras dele ou, com muitos casos, fora da
-- primeira pagina. Medido no Postgres efemero (tests/banco): a busca "3884BE" devolvia o pedido
-- certo MAIS o de um telefone "(34) 93884-5555"; "Maria 3884" devolvia o pedido do telefone, de um
-- nome que nem era o da Maria. Causa: get_admin_orders_paged (20261163, refeita na 20261199) tira
-- do que foi digitado SO OS DIGITOS (v_search_digitos) e, com 4 ou mais, procura esses digitos nos
-- telefones -- sem olhar se o que foi digitado parecia um telefone. O "#" ja era tirado na tela
-- (src/lib/filtro-da-lista-de-pedidos.ts), mas "3884BE" continua sendo letra e digito juntos.
--
-- COMPORTAMENTO CORRETO (o que esta migration faz):
--   (1) O telefone so entra na busca quando o texto digitado PARECE telefone: so digito e os
--       enfeites de um numero (+ ( ) espaco - .), com pelo menos 4 digitos (o limiar da 20260961,
--       mantido). "3884BE", "Maria 3884" e "12345abc" deixam de procurar telefone; "(34) 98888-7777",
--       "34988887777" e os "7777" dos 4 ultimos digitos continuam achando, como hoje.
--   (2) O pedido que o NUMERO digitado nomeia vem PRIMEIRO na lista: os 6 ultimos caracteres do id
--       (sem caixa), que e' o numero que o painel mostra. Importa para o numero que e so digito (um em cada 17 pedidos,
--       ex.: "#123456"): ele tambem parece telefone, e o telefone nao pode empurra-lo para baixo.
--       Sem busca, ou com busca que nao nomeia pedido, a ordem e a de sempre (created_at DESC).
--   Nada mais muda: os filtros de status, pagamento, canal e data, a contagem (total_count), a
--   paginacao, as colunas devolvidas e a porta de admin ficam como estao.
--
-- O QUE MUDA NO CORPO, SO ISTO: uma variavel (v_parece_telefone), a linha que a calcula, a condicao
-- do telefone nos DOIS blocos (contagem e pagina) e o ORDER BY da pagina. Assinatura (8 argumentos),
-- retorno, SECURITY DEFINER, search_path ('public', 'extensions'), os dois gates (is_admin e
-- is_admin_atual, antes de qualquer leitura), dono, OID e GRANTs ficam iguais. O resto do corpo e o
-- da 20261199000000, byte a byte.
--
-- CUSTO: com a busca vazia (a lista de sempre) o ORDER BY ganha uma chave constante a mais; o
-- Postgres passa a ordenar as linhas filtradas em vez de ler o indice de created_at. A contagem da
-- mesma chamada ja le todas as linhas filtradas, entao a ordem de grandeza da chamada nao muda.
--
-- DADOS EXISTENTES: nenhuma linha de pedido, item, cliente ou historico e escrita ou lida fora do
-- SELECT da propria funcao. Muda so o catalogo (o corpo de UMA funcao). Pedido que ja existe
-- continua achavel pelos mesmos caminhos (nome, numero, cupom, rastreio, produto, telefone).
--
-- ATOMICIDADE E REAPLICACAO: sem BEGIN/COMMIT de nivel superior: o aplicador fornece a transacao
-- inteira (SET LOCAL abaixo vale so nela). O PRE-VOO aceita o corpo vigente (md5 5861dbbe0e9c007a4196f5308c17d763) OU o desta
-- migration (md5 f06b1bc03cf7bcf1fbb9d7b2f7ff4fe6); outro corpo, atributo ou permissao diferente recusa com
-- B1_BASELINE_DIVERGENT, sem escrever nada. Rodar duas vezes deixa o mesmo estado. O POS-VOO confere o
-- corpo novo e que OID, dono, ACL e todos os atributos da funcao ficaram iguais (so o prosrc muda).
--
-- ORDEM: depois da 20261199000000 (o pre-voo recusa corpo anterior). Nao tem ordem em relacao ao
-- front: o front antigo e o novo mandam o mesmo texto (sem o "#"), o banco novo so acerta quem volta.
-- Valem IKCOUS e Savy; lojas de teste ficam fora.
--
-- PROVAS: catalogo, consultas 92b (antes) e 92a (depois), so leitura. Comportamento (numero do
-- pedido nao acha telefone; telefone continua achando; o pedido do numero vem primeiro; contagem,
-- filtros e paginacao iguais): tests/banco/a-busca-de-pedido-pelo-numero-viva.cjs, SO no Postgres
-- efemero do CI.
--
-- FICHA DE VERIFICACAO pos-aplicacao (como admin, em cada loja):
--   1. Pegue o numero de um pedido recente (os 6 ultimos caracteres do id, em maiusculas) e busque
--      por ele na tela Pedidos: o primeiro resultado e o pedido, e so aparecem outros se o numero
--      aparece no nome, cupom, rastreio ou produto deles.
--   2. Busque os 4 ultimos digitos do telefone de um cliente: o pedido dele continua aparecendo.
--   3. Consulta 92a: todas as linhas ok = true.
--
-- ROLLBACK: rollback-manual-20261387000000_a_busca_de_pedido_pelo_numero_nao_vira_busca_de_telefone.sql
-- devolve o corpo da 20261199000000 byte a byte (LF), mantendo OID, dono, atributos e ACL; recusa
-- corpo desconhecido e segundo rollback. Nenhum dado e apagado. Depois dele a busca pelo numero do
-- pedido volta a trazer telefones de outras pessoas (o defeito de origem).
--
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261387000000$
DECLARE
  r record;
  v_hash text;
  v_atributos jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)', '5861dbbe0e9c007a4196f5308c17d763', 'f06b1bc03cf7bcf1fbb9d7b2f7ff4fe6')
  ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos FROM pg_proc p
     WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) nao e o corpo vigente nem o desta migration; revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = to_regprocedure(r.assinatura)
         AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
         AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
         AND l.lanname = 'plpgsql' AND p.prorettype = 'jsonb'::regtype
         AND pg_get_function_identity_arguments(p.oid) = 'p_search text, p_status text, p_start_date text, p_end_date text, p_page integer, p_page_size integer, p_payment_status text, p_canal text'
         AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_orders_paged') = 1
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_orders_paged tem assinatura, atributos ou permissoes diferentes dos esperados.';
    END IF;
    -- Fotografar OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
    PERFORM set_config('ikcous.pedidos1387_atributos', v_atributos::text, true);
  END LOOP;
END $preflight_20261387000000$;

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

DO $conferencia_20261387000000$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)')
      AND md5(replace(p.prosrc, E'\r', '')) = 'f06b1bc03cf7bcf1fbb9d7b2f7ff4fe6'
      AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.pedidos1387_atributos')::jsonb
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261387 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_20261387000000$;

NOTIFY pgrst, 'reload schema';
