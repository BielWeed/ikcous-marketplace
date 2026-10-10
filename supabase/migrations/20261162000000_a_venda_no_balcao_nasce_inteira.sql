-- ============================================================================
-- Migration 20261162000000 — a venda no balcão nasce inteira
-- (LOTE C1 da venda presencial/PDV, tarefa C1.3; desenho em
-- docs/superpowers/plans/2026-09-15-super-atualizacao-do-app.md §5.1-5.2,
-- decisões do dono D1, D2, D3 e D4)
-- ============================================================================
--
-- 1. O DEFEITO QUE ESTA MIGRATION FECHA
--
-- Depois da 20261160000000 (C1.1) o banco já sabe DIZER que um pedido veio do
-- balcão (`canal`, `vendedor_id`) e a 20261161000000 (C1.2) já acha o produto
-- pelo bipe. Falta o que de fato move dinheiro: GRAVAR a venda. Sem uma RPC,
-- a tela do PDV (C3) teria de montar a venda com cinco idas ao banco pelo
-- cliente — cabeçalho do pedido, itens, baixa de estoque, histórico de status
-- e histórico de pagamento. São cinco transações independentes: qualquer uma
-- falhando (rede do balcão caindo no meio, aba fechada, 401 no meio do
-- caminho) deixa estoque debitado SEM pedido, ou pedido SEM baixa — e o
-- catálogo mente a partir dali, para sempre, porque ninguém sabe qual metade
-- ficou. Pior: preço, subtotal e total viriam do NAVEGADOR, exatamente o que
-- a proteção de adulteração do checkout online existe para impedir.
-- Esta migration cria UMA função, `public.registrar_venda_presencial`, que faz
-- as cinco coisas numa transação só, com o preço lido do banco e o vendedor
-- lido da sessão.
--
-- 2. POR QUE O BALCÃO NÃO PASSA PELA v23/v24 (e por que isso não é duplicação)
--
-- A tentação óbvia é chamar `create_marketplace_order_v23` por dentro. Ela
-- RECUSARIA toda venda de balcão, e recusaria com razão: aquela função é do
-- checkout ONLINE e exige, em ordem, (a) uma opção de entrega escolhida —
-- pedido sem `p_shipping_option_id` é falha fechada desde a emenda de 03/09
-- (20261081000000:324-334) —, (b) uma cotação de frete ou entrega local com
-- portão de CEP (:403-409), (c) `p_total_amount` batendo com o total
-- calculado dentro de ±R$ 0,05, e (d) um caminho inteiro de cupom. O balcão
-- não tem NADA disso: o cliente está na frente do balconista, leva a
-- mercadoria na mão, não há CEP, não há frete, não há cupom e não existe
-- "total que o cliente mandou" — o total é a conta que a máquina faz.
-- O que se REAPROVEITA da v23 é a FORMA, não o corpo: travar a linha do
-- produto antes de conferir (`FOR NO KEY UPDATE`, com a ordem que o comentário
-- de :235-275 explica), conferir preço e estoque com o que está travado,
-- inserir o cabeçalho dentro de um bloco que trata `unique_violation`, e só
-- então baixar estoque XOR e gravar o snapshot do item. Nenhuma linha da v23
-- ou da v24 é lida, alterada ou chamada aqui.
--
-- 3. POR QUE `payment_status = 'recebido_na_entrega'` E NÃO UM OITAVO VALOR (D1)
--
-- A CHECK de `payment_status` já tem sete valores, e o sétimo — criado pela
-- 20261020000000 para o lojista registrar dinheiro recebido na mão — descreve
-- EXATAMENTE o que acontece no balcão: a loja recebeu, fora de qualquer
-- gateway, e quem afirma isso é um humano da loja. Um oitavo valor
-- ('presencial', 'balcao') significaria a MESMA coisa com outro nome, e todo
-- consumidor de payment_status (painel, selo, relatório, o filtro de dinheiro
-- fora do fluxo) passaria a precisar de dois testes onde hoje tem um — e o
-- dia em que alguém esquecer o segundo, a venda de balcão some do relatório.
-- Decisão do dono D1: o rótulo por canal ("Balcão" em vez de "Recebido na
-- entrega") é trabalho de TELA, não de banco, e entra em C4. A CHECK de
-- `payment_status` NÃO é tocada aqui.
--
-- 4. O QUE ESTA MIGRATION FAZ, NA ORDEM
--
--   1. Cria `public.registrar_venda_presencial(jsonb, text, uuid, text, text,
--      numeric, text, uuid)` — `RETURNS jsonb`, `SECURITY DEFINER`,
--      `SET search_path = pg_catalog, pg_temp`.
--   2. `REVOKE ALL` da função de PUBLIC/anon/authenticated/service_role
--      (função nova nasce com EXECUTE para PUBLIC — foi esse resíduo que a
--      20261090500000 teve de limpar em massa) e `GRANT EXECUTE` só para
--      `authenticated`.
--   3. `COMMENT ON FUNCTION` dizendo o contrato para quem ler o schema.
--
-- O corpo, na ordem em que roda:
--   (1) GATE de admin (42501) como PRIMEIRA instrução — sem sessão da loja,
--       nem a existência de um produto se revela —, e logo depois a guarda de
--       sessão (`auth.uid()` nulo é 42501 também), a mesma que
--       `update_order_status_atomic` faz antes de qualquer leitura
--       (2026110000000:316-318).
--   (2) IDEMPOTÊNCIA, ANTES DE TUDO: chave repetida devolve o pedido que já
--       nasceu, com `ja_existia = true`, sem segunda baixa de estoque e sem
--       segunda linha de histórico.
--   (3) Validação dos parâmetros (forma de pagamento, itens, desconto,
--       motivo do desconto, cliente).
--   (4) Primeiro laço: trava a linha, confere preço e estoque, acumula o
--       subtotal. O preço sai SEMPRE do banco.
--   (5) Total = subtotal - desconto, com falha fechada se o desconto passar
--       do subtotal.
--   (6) Nome do cliente (a coluna é NOT NULL — baseline:3959).
--   (7) INSERT do cabeçalho, com o tratamento de `unique_violation` da corrida.
--   (8) Segundo laço: baixa de estoque XOR e snapshot do item.
--   (9) Os DOIS históricos (status e pagamento).
--  (10) Retorno: um único `jsonb_build_object`, o mesmo formato nos dois
--       caminhos (nasceu agora ou já existia).
--
-- 5. O QUE ESTA MIGRATION NÃO FAZ, DE PROPÓSITO (D2 e D3)
--
--   - NÃO cria conta de cliente. A venda de balcão é AVULSA na v1: se o
--     balconista não tiver o usuário na mão, `p_cliente_user_id` fica NULL e
--     o pedido nasce com o nome digitado (ou "Venda no balcão"). Criar conta
--     por trás do balcão é decisão de produto que o dono não tomou (D2).
--   - NÃO manda e-mail, NÃO dispara push, NÃO chama edge function nenhuma. O
--     comprovante do balcão é o papel/impressão, e um `pg_net` daqui
--     amarraria o dinheiro à disponibilidade de um serviço externo.
--   - NÃO enfileira nada para "quando a rede voltar" (D3: sem fila offline na
--     v1). Venda de balcão sem rede não nasce; nascer pela metade é pior.
--   - NÃO cria tabela de movimentação de estoque (isso é C6).
--   - NÃO cria CHECK de `payment_method`: não existe nenhuma hoje e criar uma
--     recusaria pedido legado (ex.: 'na_entrega'). A lista fechada
--     ('cash','pix','card') mora DENTRO da RPC, que é a única porta do balcão.
--
-- 6. DADOS EXISTENTES E IDEMPOTÊNCIA
--
-- Nenhuma linha é lida, comparada nem reescrita por esta migration: ela só
-- cria uma função. Não há seed. `CREATE OR REPLACE FUNCTION` substitui o corpo
-- e os `REVOKE`/`GRANT` são declarativos — reaplicar o arquivo deixa
-- exatamente o mesmo estado. `DEFAULT` nos parâmetros 3 a 8 mantém a
-- assinatura de 8 argumentos (é ela que o REVOKE/GRANT nomeia); chamar com
-- menos argumentos resolve para a MESMA função.
--
-- 7. RISCOS CONHECIDOS DESTE ARQUIVO
--
--   - `search_path = pg_catalog, pg_temp`: qualquer objeto sem `public.`
--     (ou `auth.`) quebra em tempo de EXECUÇÃO, não na criação. Por isso todo
--     nome aqui dentro está qualificado, inclusive nas subconsultas.
--   - Baixar estoque nos DOIS lugares (produto e variação) infla o catálogo
--     para sempre — é o defeito que o IF/ELSE de `devolver_estoque` documenta
--     (20261060000000:154-158). Aqui é IF/ELSE pelo mesmo motivo.
--   - A guarda de idempotência da v23 casa por `user_id`; no balcão o
--     `user_id` é o CLIENTE, não quem vendeu. Se esta função copiasse aquela
--     guarda, uma chave repetida por OUTRO balconista devolveria o pedido
--     alheio. Aqui a guarda casa por `canal` + `vendedor_id`.
--   - `registrar_pagamento_recebido` RECUSA pedido com `payment_status` não
--     nulo (20261020000000:133-134). Como a venda de balcão já nasce
--     'recebido_na_entrega', ela nunca passa por lá — e não precisa.
--   - O job rpc-ci aplica TODAS as migrations do zero: um erro de SQL aqui
--     derruba o job inteiro, não só a prova nova.
--
-- 8. COMO APLICAR, VERIFICAR E DESFAZER
--
-- COMO APLICAR: exclusivamente em transação externa, via
-- `node scripts/db-apply.cjs <arquivo.sql>` (uma transação por arquivo) ou
-- `psql -1`. Sem `BEGIN`/`COMMIT` de nível superior neste arquivo (regra da
-- casa).
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (o comportamento tem prova automática na
-- invariante (d) de tests/banco/invariantes-dinheiro.cjs, que o job rpc-ci
-- roda contra as migrations aplicadas do zero):
--
--   1. SELECT p.prosecdef, p.proconfig
--        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = 'registrar_venda_presencial';
--      -- esperado: 1 linha, prosecdef = true,
--      -- proconfig = {"search_path=pg_catalog, pg_temp"}.
--
--   2. SELECT has_function_privilege('anon',
--        'public.registrar_venda_presencial(jsonb, text, uuid, text, text, numeric, text, uuid)',
--        'EXECUTE') AS anon,
--        has_function_privilege('authenticated', '...mesma assinatura...', 'EXECUTE') AS logado,
--        has_function_privilege('service_role', '...mesma assinatura...', 'EXECUTE') AS servico;
--      -- esperado: false, true, false.
--
--   3. Como usuário SEM papel admin:
--      SELECT public.registrar_venda_presencial('[]'::jsonb, 'cash');
--      -- esperado: 42501 «Acesso negado: só a loja registra venda no balcão.»
--
--   4. Como admin, num produto de teste com estoque 10 (ROLLBACK no fim):
--      BEGIN;
--        SELECT public.registrar_venda_presencial(
--          '[{"product_id":"<uuid>","variant_id":null,"quantity":2}]'::jsonb,
--          'cash', NULL, 'Cliente do Balcão', NULL, 0, NULL,
--          '<uuid-de-idempotencia>');
--        -- esperado: jsonb com ja_existia=false, order.canal='presencial',
--        -- order.status='delivered', order.payment_status='recebido_na_entrega',
--        -- order.shipping=0, order.expires_at=null e 1 item.
--        -- Repetir a MESMA chamada: ja_existia=true, MESMO order.id, estoque
--        -- inalterado.
--      ROLLBACK;
--
--   5. Prova do par (estática, sem banco):
--      node scripts/db-prove-rollback.cjs \
--        supabase/migrations/20261162000000_a_venda_no_balcao_nasce_inteira.sql
--
-- FORA DO ESCOPO, de propósito: aplicar de verdade no banco (é
-- `node scripts/db-apply.cjs`, fora do PR); o parâmetro `p_canal` de
-- `get_admin_orders_paged` (C1.4); a tela do PDV que chama esta RPC (C3); o
-- rótulo "Balcão" no painel (C4); a assinatura em
-- src/types/database.types.ts, que entra junto com o consumidor (C3).
--
-- ROLLBACK MANUAL: versionado ao lado em
-- rollback-manual-20261162000000_a_venda_no_balcao_nasce_inteira.sql — a
-- função é NOVA, então o rollback só a derruba.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registrar_venda_presencial(p_itens jsonb, p_pagamento text, p_cliente_user_id uuid DEFAULT NULL, p_cliente_nome text DEFAULT NULL, p_cliente_whatsapp text DEFAULT NULL, p_desconto numeric DEFAULT 0, p_observacao text DEFAULT NULL, p_idempotency_key uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, pg_temp
AS $function$
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
$function$;

-- Função NOVA nasce com EXECUTE para PUBLIC: sem este REVOKE, a chave anônima
-- que vai no bundle do site registra venda no balcão. Foi esse resíduo que a
-- 20261090500000 teve de limpar em massa. `service_role` fica de fora de
-- propósito: nenhuma edge function registra venda de balcão, e porta que não
-- existe não é arrombada — se alguma precisar depois, entra como migration
-- própria, com a conta feita.
REVOKE ALL ON FUNCTION public.registrar_venda_presencial(jsonb, text, uuid, text, text, numeric, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_venda_presencial(jsonb, text, uuid, text, text, numeric, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.registrar_venda_presencial(jsonb, text, uuid, text, text, numeric, text, uuid) IS 'PDV/balcão: grava a venda presencial INTEIRA numa transação só — cabeçalho, itens, baixa de estoque XOR (variação OU produto, nunca os dois), histórico de status e histórico de pagamento. Só admin (is_admin()). Preço e total saem do BANCO: não existe parâmetro de preço, de total nem de vendedor — vendedor_id e pagamento_recebido_por são sempre auth.uid(). O pedido nasce canal=presencial, status=delivered, payment_status=recebido_na_entrega, shipping=0 e expires_at NULL. Chave de idempotência repetida devolve o MESMO pedido com ja_existia=true, sem debitar estoque de novo; chave de outro canal ou de outro vendedor é recusada com 23505.';
