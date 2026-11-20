-- Rollback manual da 20261410000000: repoe integralmente os corpos anteriores.
-- Conserva as duas colunas e os rotulos ja gravados no pedido.
-- O aplicador abre a transacao; CREATE OR REPLACE preserva dono e ACL.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback$
DECLARE
  alvo record;
  v_oid oid;
  v_hash text;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)', 'b404a8397a6490c86fb192d85fd5b6c9', 'bfef98c2eeeaf9014d92d3e4cd97764d'),
      ('public.get_orders_by_otp_v2(text,text,text,text)', '02208ac9d2abe2e8b03790349d491ecb', '96f080db2a488d8887a2dfd959bd9862')
    ) AS f(assinatura, vigente, desta)
  LOOP
    v_oid := to_regprocedure(alvo.assinatura);
    SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash
      FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
    IF v_hash IS NULL OR v_hash NOT IN (alvo.vigente, alvo.desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo inesperado para % (md5 %).', alvo.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('get_admin_orders_paged', 'public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)',
       'p_search text DEFAULT ''''::text, p_status text DEFAULT ''all''::text, p_start_date text DEFAULT ''''::text, p_end_date text DEFAULT ''''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_payment_status text DEFAULT ''all''::text, p_canal text DEFAULT ''all''::text',
       ARRAY['search_path=public, extensions']::text[], false),
      ('get_orders_by_otp_v2', 'public.get_orders_by_otp_v2(text,text,text,text)',
       'p_email text, p_whatsapp text, p_fragmento text, p_otp text',
       ARRAY['search_path=public']::text[], true)
    ) AS e(nome, assinatura, argumentos, config, anon_pode)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure(e.assinatura)
        AND p.prokind = 'f' AND p.prosecdef AND p.provolatile = 'v'
        AND NOT p.proisstrict AND NOT p.proretset AND l.lanname = 'plpgsql'
        AND p.proconfig = e.config
        AND pg_get_function_arguments(p.oid) = e.argumentos
        AND pg_get_function_result(p.oid) = 'jsonb'
        AND (SELECT count(*) FROM pg_catalog.pg_proc q
             WHERE q.pronamespace = 'public'::regnamespace AND q.proname = e.nome) = 1
        AND has_function_privilege('anon', p.oid, 'EXECUTE') = e.anon_pode
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT EXISTS (
          SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
          WHERE g.grantee = 0 AND g.privilege_type = 'EXECUTE'
        )
    )
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: assinatura, atributos ou EXECUTE da lista do painel ou do rastreio divergentes.';
  END IF;
END $preflight_rollback$;

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
            o.created_at DESC,
            -- Desempate pelo id (unico): pedidos do mesmo instante (importacao, balcao, lote) saiam numa ordem que podia
            -- mudar de uma pagina para outra, e a paginacao por OFFSET repetia um e escondia outro (20261399980000).
            -- O pedido do numero digitado continua primeiro e a data continua mandando.
            o.id
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v2("p_email" "text", "p_whatsapp" "text", "p_fragmento" "text", "p_otp" "text") RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_rec RECORD;
    v_max_tentativas CONSTANT integer := 5;
    v_fragmento text := trim(coalesce(p_fragmento, ''));
BEGIN
    -- O trio, com as MESMAS regras da generate_order_otp_v2 (20260820000000):
    -- os dois canais obrigatorios e o fragmento so com o alfabeto de um UUID.
    IF coalesce(trim(p_email), '') = '' OR coalesce(trim(p_whatsapp), '') = ''
       OR v_fragmento !~ '^[0-9a-fA-F-]{6,}$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Código inválido ou expirado.');
    END IF;

    -- So o codigo do pedido que confere com o trio. Quem sabe so o e-mail nao
    -- alcanca codigo nenhum, logo nao gasta tentativa de ninguem nem descobre
    -- se ha codigo ativo: sem trio, a resposta e' a mesma de "nao ha codigo".
    -- 20261341: a linha do codigo fica TRAVADA (so a de otp_verifications, nao a do pedido) ate o fim desta
    -- chamada. Sem a trava, N chamadas simultaneas liam a mesma contagem de tentativas, cada uma errava
    -- e gravava "+1" sobre o mesmo valor: o teto de 5 nao valia. Agora a segunda espera a primeira
    -- terminar e le a contagem ja atualizada (ou, se o codigo ja foi usado, nao o encontra mais).
    SELECT v.* INTO v_rec
      FROM public.otp_verifications v
      JOIN public.marketplace_orders o ON o.id = v.order_id
      LEFT JOIN auth.users u ON u.id = o.user_id
     WHERE regexp_replace(
               coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''),
               '[^0-9]', '', 'g'
           ) = regexp_replace(p_whatsapp, '[^0-9]', '', 'g')
       AND (
             LOWER(coalesce(o.customer_data->>'email', '')) = LOWER(trim(p_email))
          OR LOWER(coalesce(u.email, ''))                   = LOWER(trim(p_email))
       )
       AND o.id::text ILIKE '%' || v_fragmento
       AND v.expires_at > NOW()
       AND v.verified = false
     ORDER BY v.created_at DESC
     LIMIT 1
     FOR UPDATE OF v;

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

    -- 20261342: a coluna notes NAO sai mais daqui. Ela guarda a observacao da cliente MISTURADA com a
    -- anotacao interna que a loja gravava ali antes de 17/10/2026 (20261247); a tela do convidado nao a usa.
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
                'payment_status', o.payment_status,
                'coupon_code', o.coupon_code,
                'tracking_code', o.tracking_code,
                'created_at', o.created_at,
                'updated_at', o.updated_at,
                'customer_name', o.customer_name,
                'customer_data', (
                    -- LGPD (migration 20261181000000, achado alto): o CPF do
                    -- destinatário nunca sai desta RPC — nem em
                    -- `customer_data.cpf` (migration 20261172) nem dentro de
                    -- `customer_data.address` (janela 23-26/09, antes de o
                    -- INSERT do pedido aprender a tirar a chave do endereço).
                    -- Quem chega até aqui só provou o OTP do PRÓPRIO pedido —
                    -- não precisa do CPF para nada nesta tela: o front já
                    -- descarta a chave antes de guardar o pedido no cache do
                    -- localStorage (src/lib/mappers.ts, semCpf()), e é o
                    -- servidor (melhor-envio-etiqueta) quem usa o CPF para
                    -- emitir a etiqueta, nunca o navegador de quem digitou o
                    -- código.
                    --
                    -- RODADA 2 (revisão de risco):
                    --   * achado 4 — `customer_data` ESCALAR (não objeto) não
                    --     tem chave para `jsonb - text` tirar; sem este
                    --     primeiro WHEN, `o.customer_data - 'cpf'` explode com
                    --     "cannot delete from scalar" e derruba a verificação
                    --     de OTP inteira para aquele pedido. Devolve o valor
                    --     cru: não há CPF para vazar dentro de um escalar.
                    --   * achado 5 — quando `address` era só `{"cpf":"..."}`,
                    --     tirar a chave deixava `{}` (TRUTHY em JS, vencia
                    --     `row.address` — o endereço de verdade do JOIN — na
                    --     cadeia `||` de `src/lib/mappers.ts`). Vira JSON
                    --     `null` (mesma régua da `20261172`,
                    --     `v_address_data_sem_cpf`): `null` também é
                    --     `typeof === "object"` em JS, mas é FALSY, então a
                    --     cadeia cai para a próxima fonte.
                    --   * achado 6 (informativo, sem código) — `address` como
                    --     ARRAY não entra no segundo WHEN (`jsonb_typeof` diz
                    --     'array', não 'object') e mantém qualquer `cpf`
                    --     aninhado. O front nunca manda array em `address`
                    --     (só objeto ou string); se um dia mandar, este
                    --     ponto precisa ser revisto.
                    CASE
                        WHEN jsonb_typeof(o.customer_data) <> 'object' THEN o.customer_data
                        WHEN jsonb_typeof(o.customer_data -> 'address') = 'object' THEN
                            (o.customer_data - 'cpf')
                                || jsonb_build_object(
                                     'address',
                                     CASE
                                         WHEN ((o.customer_data -> 'address') - 'cpf') = '{}'::jsonb THEN NULL
                                         ELSE (o.customer_data -> 'address') - 'cpf'
                                     END
                                   )
                        ELSE
                            o.customer_data - 'cpf'
                    END
                ),
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

DO $conferencia$
BEGIN
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc
      WHERE oid = to_regprocedure('public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)'))
      IS DISTINCT FROM 'b404a8397a6490c86fb192d85fd5b6c9' THEN
    RAISE EXCEPTION '20261410000000: corpo inesperado de get_admin_orders_paged apos rollback.';
  END IF;
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_catalog.pg_proc
      WHERE oid = to_regprocedure('public.get_orders_by_otp_v2(text,text,text,text)'))
      IS DISTINCT FROM '02208ac9d2abe2e8b03790349d491ecb' THEN
    RAISE EXCEPTION '20261410000000: corpo inesperado de get_orders_by_otp_v2 apos rollback.';
  END IF;
END $conferencia$;

NOTIFY pgrst, 'reload schema';
