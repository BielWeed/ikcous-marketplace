-- ============================================================================
-- Rollback manual — a venda repetida do balcão devolve a venda feita (20261235000000)
-- ============================================================================
-- Recria public.registrar_venda_presencial(...) com o corpo VIGENTE de antes (o da 20261199000000, byte a byte: o
-- md5 de replace(prosrc, E'\r', '') volta a ser 6a421904a7c99a0e17ca58f2f891c71d, e a prova viva confere).
-- Assinatura, SECURITY DEFINER, VOLATILE, search_path (pg_catalog, pg_temp) e retorno são os mesmos da migration.
--
-- A ACL e o comentário da função NÃO são tocados: CREATE OR REPLACE preserva dono, privilégios e comentário, e
-- este arquivo não tem nenhum GRANT, REVOKE nem COMMENT.
--
-- COM ELE VOLTA O DEFEITO: a retentativa com a mesma chave que chega antes de a primeira commitar volta a poder
-- receber "Estoque insuficiente" quando a primeira levou a última unidade (a venda existe; só a resposta mente).
--
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui. As vendas feitas enquanto a migration
-- valeu FICAM (são fatos).
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se a função não existir ou tiver sobrecarga; se o corpo vivo não for um
-- dos dois conhecidos (o desta migration, ou o vigente — e então rodar de novo reescreve o mesmo texto); se os
-- atributos não forem os de sempre; ou se a ACL mudou. A conferência final recusa se o corpo não voltou ao
-- vigente, se algum atributo mudou ou se a ACL mudou.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de
-- nível superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

DO $preflight_rollback_20261235$
DECLARE
  v_fn CONSTANT text := 'public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)';
  v_oid oid := to_regprocedure('public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)');
  v_hash text;
  r record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe — nada a devolver.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'registrar_venda_presencial') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: registrar_venda_presencial tem sobrecarga em public — revise antes de devolver o corpo vigente.';
  END IF;

  -- O corpo vivo tem de ser o desta migration (desfaz) ou o vigente (já desfeito: reescreve o mesmo texto).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)', '6a421904a7c99a0e17ca58f2f891c71d', '996caf02505ac16a8bded73bcf8900aa')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o desta migration nem o vigente — uma redefinição posterior está no ar; revise antes de sobrescrever.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proisstrict
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
          AND pg_get_function_result(p.oid) = 'jsonb'
          AND p.pronargs = 8
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, STRICT, search_path, retorno ou argumentos) não são os conhecidos — revise antes de devolver o corpo vigente.', v_fn;
  END IF;

  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (EXECUTE só para authenticated) — revise antes de devolver o corpo vigente.', v_fn;
  END IF;
END $preflight_rollback_20261235$;

-- registrar_venda_presencial: corpo vigente da 20261199000000_portas_do_painel_exigem_admin_atual.sql, SEM a trava
-- consultiva pela chave.
CREATE OR REPLACE FUNCTION public.registrar_venda_presencial(p_itens jsonb, p_pagamento text, p_cliente_user_id uuid DEFAULT NULL::uuid, p_cliente_nome text DEFAULT NULL::text, p_cliente_whatsapp text DEFAULT NULL::text, p_desconto numeric DEFAULT 0, p_observacao text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
    v_vendedor uuid;
    v_order_id uuid;
    v_canal_existente text;
    v_vendedor_existente uuid;
    v_ja_existia boolean := false;

    v_item jsonb;
    v_product_id uuid;
    v_variant_id uuid;
    v_quantity integer;
    v_item_name text;
    v_rows_affected integer;

    v_db_price numeric;
    v_db_stock integer;
    v_subtotal numeric := 0;
    v_desconto numeric := 0;
    v_total numeric := 0;
    v_customer_name text;
BEGIN
    -- (1) O GATE VEM ANTES DE QUALQUER LEITURA. Quem não é da loja não pode
    -- nem descobrir que um produto existe pela mensagem de erro que recebe.
    IF public.is_admin() IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso negado: só a loja registra venda no balcão.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF public.is_admin_atual() IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso negado: só a loja registra venda no balcão.';
    END IF;

    -- Quem vende é SEMPRE a sessão, nunca um parâmetro: um `p_vendedor` seria
    -- o balconista podendo assinar a venda no nome de outro.
    v_vendedor := auth.uid();
    IF v_vendedor IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Não autorizado: é preciso estar autenticado para registrar a venda.';
    END IF;

    -- (2) IDEMPOTÊNCIA, ANTES DE TUDO (forma de 20261081000000:125-133). O
    -- balcão é o lugar onde o mesmo clique mais se repete: a rede do
    -- estabelecimento cai DEPOIS do commit, o operador não vê a confirmação e
    -- bipa "finalizar" de novo. A retentativa honesta tem de receber o pedido
    -- que JÁ NASCEU — não um gêmeo com o estoque debitado duas vezes.
    --
    -- A guarda é OUTRA que a da v23, de propósito: lá ela casa por `user_id`,
    -- que no balcão é o CLIENTE (quase sempre NULL, porque a venda é avulsa).
    -- Casar por cliente aqui devolveria pedido alheio para qualquer chave
    -- repetida. Quem responde pela chave da venda de balcão é o CANAL e o
    -- BALCONISTA.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT o.id, o.canal, o.vendedor_id
          INTO v_order_id, v_canal_existente, v_vendedor_existente
          FROM public.marketplace_orders o
         WHERE o.idempotency_key = p_idempotency_key;

        IF v_order_id IS NOT NULL THEN
            IF v_canal_existente IS DISTINCT FROM 'presencial'
               OR v_vendedor_existente IS DISTINCT FROM v_vendedor THEN
                RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Esta chave de venda já foi usada por outro pedido.';
            END IF;
            v_ja_existia := true;
        END IF;
    END IF;

    IF NOT v_ja_existia THEN
        -- (3) VALIDAÇÃO DOS PARÂMETROS.
        --
        -- A lista de formas de pagamento é FECHADA aqui dentro porque o banco
        -- não tem CHECK de `payment_method` (e criar uma recusaria pedido
        -- legado, ex.: 'na_entrega'). Esta RPC é a única porta do balcão, e é
        -- nela que a lista vale.
        IF p_pagamento IS NULL OR p_pagamento NOT IN ('cash','pix','card') THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Forma de pagamento inválida para venda no balcão.';
        END IF;

        IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' OR jsonb_array_length(p_itens) = 0 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A venda precisa de pelo menos um item.';
        END IF;

        -- Teto de itens: o balcão não vende 200 linhas diferentes numa
        -- compra; um payload maior que isso é engano ou abuso, e cada item
        -- custa uma trava de linha dentro da transação.
        IF jsonb_array_length(p_itens) > 200 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Venda com itens demais.';
        END IF;

        v_desconto := round(COALESCE(p_desconto, 0), 2);
        IF v_desconto < 0 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='O desconto não pode ser negativo.';
        END IF;

        -- D4: desconto no balcão SEM motivo escrito é dinheiro que some sem
        -- rastro. O motivo vira `notes` do pedido, que o painel já mostra.
        IF v_desconto > 0 AND NULLIF(btrim(COALESCE(p_observacao,'')),'') IS NULL THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Informe o motivo do desconto.';
        END IF;

        IF p_cliente_user_id IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_cliente_user_id) THEN
                RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Cliente não encontrado.';
            END IF;
        END IF;

        -- (4) PRIMEIRO LAÇO — TRAVAR E CONFERIR (forma de 20261081000000:218-297,
        -- sem a parte de frete e de cupom, que o balcão não tem). O preço sai
        -- SEMPRE do banco: não existe parâmetro de preço nesta RPC.
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
        LOOP
            v_product_id := (v_item->>'product_id')::uuid;
            v_variant_id := (v_item->>'variant_id')::uuid;
            v_quantity := (v_item->>'quantity')::integer;

            IF v_quantity IS NULL OR v_quantity <= 0 THEN
                RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Quantidade inválida para um dos itens.';
            END IF;

            IF v_variant_id IS NOT NULL THEN
                SELECT COALESCE(v.price_override, p.preco_venda), v.stock_increment, p.nome
                  INTO v_db_price, v_db_stock, v_item_name
                  FROM public.produtos p
                  JOIN public.product_variants v ON v.product_id = p.id
                 WHERE v.id = v_variant_id AND p.id = v_product_id
                   AND v.active = true AND p.ativo = true AND p.deleted_at IS NULL
                   FOR NO KEY UPDATE OF v;
            ELSE
                -- A TRAVA DE LINHA VEM PRIMEIRO, e a guarda de variação
                -- obrigatória vem DEPOIS — é a ordem que a v23 tem desde
                -- 20261081000000:235-275, e o comentário de lá explica por que
                -- inverter reabre uma corrida sob READ COMMITTED: com a guarda
                -- antes, ela e o SELECT tomam SNAPSHOTS DIFERENTES, e um
                -- UPDATE concorrente em `produtos.ativo` passa entre os dois.
                SELECT p.preco_venda, p.estoque, p.nome
                  INTO v_db_price, v_db_stock, v_item_name
                  FROM public.produtos p
                 WHERE p.id = v_product_id AND p.ativo = true AND p.deleted_at IS NULL
                   FOR NO KEY UPDATE;

                -- Bipar o produto pai de um produto que TEM variação ativa
                -- venderia pelo preço errado e baixaria o estoque agregado em
                -- vez do tamanho escolhido — o operador entrega a caixa e o
                -- estoque daquele tamanho nunca desce.
                IF v_db_price IS NOT NULL AND EXISTS (
                    SELECT 1
                      FROM public.product_variants v
                     WHERE v.product_id = v_product_id
                       AND v.active = true
                ) THEN
                    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE=format('Escolha uma variação para o produto %s.', COALESCE(v_item_name,'selecionado'));
                END IF;
            END IF;

            IF v_db_price IS NULL THEN
                RAISE EXCEPTION USING ERRCODE='22023', MESSAGE=format('Produto %s não disponível.', COALESCE(v_item_name,'não encontrado'));
            END IF;

            IF v_db_stock < v_quantity THEN
                RAISE EXCEPTION USING ERRCODE='22023', MESSAGE=format('Estoque insuficiente para o produto %s (Disponível: %s, Solicitado: %s)', v_item_name, v_db_stock, v_quantity);
            END IF;

            v_subtotal := v_subtotal + (v_db_price * v_quantity);
        END LOOP;

        -- (5) TOTAL. Falha FECHADA, ao contrário do clamp da v23
        -- (20261081000000:457-459): lá o desconto vem de um cupom e sobrar
        -- centavo é arredondamento; aqui o desconto é DIGITADO pelo
        -- balconista, e um valor maior que a venda é erro de digitação — zerar
        -- calado esconderia o engano.
        IF v_desconto > v_subtotal THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='O desconto não pode ser maior que o subtotal da venda.';
        END IF;
        v_total := v_subtotal - v_desconto;

        -- (6) NOME DO CLIENTE. A coluna é NOT NULL (baseline:3959) e a venda
        -- de balcão é avulsa por desenho (D2): sem nome digitado e sem perfil,
        -- o pedido nasce como "Venda no balcão", que é a verdade.
        v_customer_name := COALESCE(
            NULLIF(btrim(p_cliente_nome),''),
            (SELECT NULLIF(btrim(pr.full_name),'') FROM public.profiles pr WHERE pr.id = p_cliente_user_id),
            'Venda no balcão'
        );

        -- (7) INSERT DO CABEÇALHO. `expires_at` fica FORA da lista de colunas
        -- de propósito: aquela coluna é a reserva de 30 min do PIX, e a venda
        -- de balcão já está paga e entregue — NULL é o valor certo.
        -- `customer_phone` também fica de fora, por paridade com a v23
        -- (20261081000000:485-491), que guarda o whatsapp em `customer_data`.
        BEGIN
            INSERT INTO public.marketplace_orders (
                user_id, total, subtotal, shipping, discount,
                payment_method, status, payment_status, pagamento_recebido_em,
                pagamento_recebido_por, vendedor_id, canal,
                customer_name, customer_data, notes, idempotency_key
            ) VALUES (
                p_cliente_user_id, v_total, v_subtotal, 0, v_desconto,
                p_pagamento, 'delivered', 'recebido_na_entrega', now(),
                v_vendedor, v_vendedor, 'presencial',
                v_customer_name,
                jsonb_build_object(
                    'whatsapp', NULLIF(btrim(COALESCE(p_cliente_whatsapp,'')),''),
                    'canal', 'presencial'
                ),
                NULLIF(btrim(COALESCE(p_observacao,'')),''),
                p_idempotency_key
            ) RETURNING id INTO v_order_id;

        EXCEPTION
            WHEN unique_violation THEN
                -- A corrida PERDEU: a requisição gêmea com a MESMA chave
                -- commitou primeiro. Devolvo o pedido dela — pela MESMA guarda
                -- do passo (2), nunca por `user_id`.
                SELECT o.id, o.canal, o.vendedor_id
                  INTO v_order_id, v_canal_existente, v_vendedor_existente
                  FROM public.marketplace_orders o
                 WHERE o.idempotency_key = p_idempotency_key;

                IF v_order_id IS NULL
                   OR v_canal_existente IS DISTINCT FROM 'presencial'
                   OR v_vendedor_existente IS DISTINCT FROM v_vendedor THEN
                    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Esta chave de venda já foi usada por outro pedido.';
                END IF;
                v_ja_existia := true;
        END;
    END IF;

    IF NOT v_ja_existia THEN
        -- (8) SEGUNDO LAÇO — BAIXA DE ESTOQUE XOR E SNAPSHOT DO ITEM
        -- (forma de 20261081000000:513-554). IF/ELSE, nunca dois IF: debitar
        -- a variação E o produto pai desinfla o catálogo para sempre — é o
        -- defeito que o IF/ELSE de `devolver_estoque` documenta
        -- (20261060000000:154-158). O `AND ... >=` no WHERE mais o
        -- `ROW_COUNT = 0` são a segunda trava: entre a conferência do primeiro
        -- laço e este UPDATE, o estoque pode ter sido levado por outra venda.
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
        LOOP
            v_product_id := (v_item->>'product_id')::uuid;
            v_variant_id := (v_item->>'variant_id')::uuid;
            v_quantity := (v_item->>'quantity')::integer;

            IF v_variant_id IS NOT NULL THEN
                UPDATE public.product_variants
                   SET stock_increment = stock_increment - v_quantity
                 WHERE id = v_variant_id AND stock_increment >= v_quantity;

                GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
                IF v_rows_affected = 0 THEN
                    SELECT p.nome INTO v_item_name
                      FROM public.produtos p
                      JOIN public.product_variants v ON v.product_id = p.id
                     WHERE v.id = v_variant_id;
                    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE=format('Estoque insuficiente para o produto %s', v_item_name);
                END IF;

                -- Releitura do preço DEPOIS da baixa, como a v23 faz
                -- (20261081000000:530-534 e :546): o snapshot do item é o
                -- preço que valia no instante em que a peça saiu da prateleira.
                SELECT COALESCE(v.price_override, p.preco_venda), p.nome
                  INTO v_db_price, v_item_name
                  FROM public.produtos p
                  JOIN public.product_variants v ON v.product_id = p.id
                 WHERE v.id = v_variant_id;
            ELSE
                UPDATE public.produtos
                   SET estoque = estoque - v_quantity
                 WHERE id = v_product_id AND estoque >= v_quantity;

                GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
                IF v_rows_affected = 0 THEN
                    SELECT p.nome INTO v_item_name FROM public.produtos p WHERE p.id = v_product_id;
                    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE=format('Estoque insuficiente para o produto %s', v_item_name);
                END IF;

                SELECT p.preco_venda, p.nome
                  INTO v_db_price, v_item_name
                  FROM public.produtos p
                 WHERE p.id = v_product_id;
            END IF;

            -- As MESMAS 6 colunas da v23 (20261081000000:549-553).
            -- `image_url` fica FORA: o mapper do front já cai na imagem do
            -- produto quando a do item é nula (src/lib/mappers.ts:243-246), e
            -- copiar a URL aqui seria uma segunda verdade envelhecendo sozinha.
            INSERT INTO public.marketplace_order_items (
                order_id, product_id, variant_id, quantity, price, product_name
            ) VALUES (
                v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price, v_item_name
            );
        END LOOP;

        -- (9) OS DOIS HISTÓRICOS. São listas de naturezas diferentes: uma
        -- conta a vida do PEDIDO, a outra a do DINHEIRO (20261020000000:56-58).
        -- A venda de balcão nasce nos dois pontos finais de uma vez, e é por
        -- isso que `old_status` e `payment_status_antes` são NULL: não houve
        -- estado anterior nenhum.
        INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
        VALUES (v_order_id, NULL, 'delivered', 'Venda no balcão', v_vendedor);

        -- A CHECK de `acao` só aceita 'recebido' | 'desfeito'
        -- (20261020000000:61) — nada de rótulo novo por canal aqui.
        INSERT INTO public.marketplace_order_payment_history (order_id, acao, payment_status_antes, payment_status_depois, created_by)
        VALUES (v_order_id, 'recebido', NULL, 'recebido_na_entrega', v_vendedor);
    END IF;

    -- (10) UM ÚNICO ponto de montagem do retorno, para os DOIS caminhos. Com
    -- duas cópias do formato, o dia em que uma chave for acrescentada só de um
    -- lado, a retentativa passa a devolver um objeto diferente da primeira
    -- chamada — e a tela do PDV quebra só na repetição, que é o caso raro.
    RETURN jsonb_build_object(
        'ja_existia', v_ja_existia,
        'order', (SELECT to_jsonb(o.*) FROM public.marketplace_orders o WHERE o.id = v_order_id),
        'items', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', i.id,
                    'product_id', i.product_id,
                    'variant_id', i.variant_id,
                    'quantity', i.quantity,
                    'price', i.price,
                    'product_name', i.product_name
                ) ORDER BY i.created_at
            )
            FROM public.marketplace_order_items i
            WHERE i.order_id = v_order_id
        ), '[]'::jsonb)
    );
END;
$$;

-- CONFERÊNCIA no instante do apply: aborta se o corpo vivo não voltou ao vigente, se algum atributo mudou ou se a
-- ACL deixou de ser a de hoje.
DO $conferencia_rollback_20261235$
DECLARE
  v_fn CONSTANT text := 'public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)';
  v_oid oid := to_regprocedure('public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia rollback 20261235: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'registrar_venda_presencial') <> 1 THEN
    RAISE EXCEPTION 'conferencia rollback 20261235: registrar_venda_presencial ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '6a421904a7c99a0e17ca58f2f891c71d' THEN
    RAISE EXCEPTION 'conferencia rollback 20261235: corpo vivo de % (hash %) não é o vigente de antes', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proisstrict
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
          AND pg_get_function_result(p.oid) = 'jsonb'
          AND p.pronargs = 8
     ) THEN
    RAISE EXCEPTION 'conferencia rollback 20261235: atributos de % mudaram', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia rollback 20261235: ACL de % mudou', v_fn;
  END IF;
END $conferencia_rollback_20261235$;
