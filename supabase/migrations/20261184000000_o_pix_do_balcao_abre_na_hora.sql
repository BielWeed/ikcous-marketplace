-- ============================================================================
-- Migration 20261184000000 — o PIX do balcão abre na hora
-- (frente A de docs/superpowers/plans/2026-09-28-sessoes-paralelas.md; plano
-- docs/superpowers/plans/2026-09-28-balcao-pix-no-balcao.md; investigação
-- docs/superpowers/specs/2026-09-28-balcao-pix-investigacao.md, defeito D1)
-- ============================================================================
--
-- 1. O DEFEITO QUE ESTA MIGRATION FECHA
--
-- Na tela Vender, "PIX na hora" chama `registrar_venda_presencial(..., 'pix')`
-- (20261162000000:263-395), que grava o pedido JÁ PAGO e ENTREGUE
-- (`payment_status='recebido_na_entrega'`, `pagamento_recebido_em=now()`) no
-- clique — nenhum QR, nenhuma cobrança, nenhuma conferência. O Financeiro
-- conta a entrada, o CRM conta a venda e o estoque sai, sem um centavo ter
-- entrado. O pedido do dono (28/09/2026): "se a pessoa selecionar que vai
-- pagar no PIX — como a gente tem integração — tem que abrir o PIX ali".
--
-- 2. O QUE ESTA MIGRATION FAZ
--
--   1. `public.iniciar_venda_presencial_pix(jsonb, uuid, uuid, text, text,
--      numeric, text)` — SECURITY DEFINER, `search_path = pg_catalog,
--      pg_temp`. As MESMAS travas de `registrar_venda_presencial` (admin
--      primeiro, vendedor = sessão, preço e estoque lidos do banco com trava
--      de linha, baixa XOR variação/produto, desconto em 2 casas com motivo,
--      teto de 200 itens, cliente existente), mas o pedido nasce À ESPERA do
--      PIX, exatamente como um pedido PIX do site:
--        status='pending', payment_status='aguardando',
--        payment_method='online', metodo_online='pix', canal='presencial',
--        expires_at = now() + 30 min, pagamento_recebido_em NULL.
--      O estoque sai AGORA (é a reserva de 30 min do PIX: a varredura
--      `expirar_pedidos_vencidos` devolve se ninguém pagar — 20260901000000
--      :228-270, filtro aguardando+pending). Quem cria a cobrança no Mercado
--      Pago é a edge `cobrar-pix-no-balcao`; quem confirma é o caminho de
--      sempre (webhook/reconciliação → `confirmar_pagamento`), SEM mudança.
--   2. Gatilho `tr_venda_do_balcao_paga_e_entregue` (BEFORE UPDATE OF
--      payment_status em marketplace_orders): quando um pedido do BALCÃO sai
--      de 'aguardando' para 'pago' ainda 'pending', ele vira 'delivered' na
--      MESMA linha (o cliente está na frente do balconista e leva a
--      mercadoria na hora) e ganha uma linha de histórico.
--   3. REVOKE/GRANT e COMMENT.
--
-- 3. POR QUE `payment_method='online'` E NÃO 'pix'
--
-- 'pix' no balcão já significa "PIX na chave da loja, conferido na mão"
-- (fica como está em `registrar_venda_presencial`). O PIX com QR é cobrado
-- pelo Mercado Pago, e é 'online' + metodo_online='pix' que faz o Financeiro
-- pôr o dinheiro na conta MERCADO PAGO, forma pix, origem 'venda_balcao'
-- (`fin__conta_da_forma`/`fin__forma_do_pedido`/`fin__movimentos`,
-- 20261177000000:298-356) — sem tocar em nenhuma função `fin_*`. O caixa da
-- loja física só soma `payment_method='cash'` (20261177000000:475-479): não
-- muda. O webhook, a reconciliação, o estorno pelo app (`estornar-pagamento`)
-- e o selo "precisa de atenção" já entendem 'online'.
--
-- 4. POR QUE UM GATILHO E NÃO A TELA MARCANDO "ENTREGUE"
--
-- O pagamento pode ser confirmado com a tela do balcão FECHADA: o webhook
-- chega depois de um F5, a aba foi descartada, a reconciliação (10 min) é
-- quem pega. Se só a tela marcasse 'delivered', a venda ficaria "pendente e
-- paga" na fila de Pedidos, como um pedido do site esperando separação e
-- envio. O gatilho roda dentro da MESMA transação de `confirmar_pagamento`
-- (que continua a ÚNICA escrita de pagamento — não é alterada): ele não toca
-- dinheiro, estoque nem payment_status; só `status` e uma linha de histórico.
-- As condições são estreitas de propósito:
--   - canal='presencial' (pedido do site NUNCA passa por aqui);
--   - OLD.payment_status='aguardando' AND NEW.payment_status='pago' — nunca
--     'pago_apos_expirar' (o estoque JÁ voltou; é caso de atenção, não de
--     entrega);
--   - OLD.status='pending' AND NEW.status='pending' — o pedido não foi
--     cancelado nem mexido por outro caminho, e o próprio UPDATE não está
--     escolhendo outro status.
--
-- 5. IDEMPOTÊNCIA DA VENDA
--
-- Chave OBRIGATÓRIA e PRÓPRIA do PIX (a tela gera uma ao tocar "Gerar PIX",
-- nunca a do cupom). A guarda casa por canal + vendedor + payment_method
-- 'online': a mesma chave usada numa venda em dinheiro (ou por outro
-- balconista) é 23505, nunca o pedido alheio. Chave repetida devolve o MESMO
-- pedido com ja_existia=true, sem segunda baixa — mesmo que ele já tenha
-- expirado ou sido pago (quem chama decide pelo estado que volta).
--
-- 6. O QUE NÃO FAZ, DE PROPÓSITO
--
--   - NÃO cria cobrança no Mercado Pago (edge `cobrar-pix-no-balcao`).
--   - NÃO altera `registrar_venda_presencial`, `confirmar_pagamento`,
--     `expirar_pedidos_vencidos`, nem nenhuma função `fin_*`/`crm_*`.
--   - NÃO exige cliente com conta (a política P6 é do checkout do site; no
--     balcão quem opera é a loja logada — decisão da coordenação, 28/09).
--   - NÃO registra `marketplace_order_payment_history`: essa tabela é do
--     recebimento MANUAL do lojista (20261020000000:56-61); o PIX com QR é
--     confirmado pelo gateway, como no site.
--
-- 7. DADOS EXISTENTES
--
-- Nenhuma linha é lida nem reescrita pela aplicação. O gatilho só alcança
-- pedido presencial 'aguardando' — que não existe antes desta função (toda
-- venda de balcão até hoje nasce 'recebido_na_entrega').
--
-- 8. COMO APLICAR, VERIFICAR E DESFAZER
--
-- Pelo workflow `aplicar-migrations.yml` (prova BEGIN/ROLLBACK + apply), só
-- pelo dono. Sem BEGIN/COMMIT neste arquivo (regra da casa). Ordem de
-- publicação: ESTA migration → edge `cobrar-pix-no-balcao` → front.
--
-- FICHA DE VERIFICAÇÃO pós-aplicação:
--   1. SELECT p.prosecdef, p.proconfig FROM pg_proc p
--       WHERE p.proname = 'iniciar_venda_presencial_pix';
--      -- esperado: true, {"search_path=pg_catalog, pg_temp"}
--   2. SELECT has_function_privilege('anon', 'public.iniciar_venda_presencial_pix(jsonb, uuid, uuid, text, text, numeric, text)', 'EXECUTE'),
--             has_function_privilege('authenticated', 'public.iniciar_venda_presencial_pix(jsonb, uuid, uuid, text, text, numeric, text)', 'EXECUTE');
--      -- esperado: false, true
--   3. SELECT tgname, tgenabled FROM pg_trigger
--       WHERE tgname = 'tr_venda_do_balcao_paga_e_entregue';
--      -- esperado: 1 linha, 'O'
--   Prova de comportamento: tests/banco/pix-do-balcao-viva.cjs (rpc-ci).
--
-- ROLLBACK MANUAL: rollback-manual-20261184000000_o_pix_do_balcao_abre_na_hora.sql
-- (derruba o gatilho e as duas funções; pedidos já criados continuam válidos
-- — são pedidos 'online' comuns, que o webhook e a expiração já tratam).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.iniciar_venda_presencial_pix(p_itens jsonb, p_idempotency_key uuid, p_cliente_user_id uuid DEFAULT NULL, p_cliente_nome text DEFAULT NULL, p_cliente_whatsapp text DEFAULT NULL, p_desconto numeric DEFAULT 0, p_observacao text DEFAULT NULL)
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
    v_metodo_existente text;
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
    -- (1) GATE antes de qualquer leitura (mesma ordem de 20261162000000:219-228).
    IF public.is_admin() IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso negado: só a loja registra venda no balcão.';
    END IF;

    v_vendedor := auth.uid();
    IF v_vendedor IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Não autorizado: é preciso estar autenticado para registrar a venda.';
    END IF;

    -- Sem chave não há como o retry depois de uma resposta perdida (rede do
    -- balcão caindo DEPOIS do commit) achar o PIX que já nasceu — e um segundo
    -- PIX seria uma segunda reserva de estoque para a mesma venda.
    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Falta a chave da venda (idempotência).';
    END IF;

    -- (2) IDEMPOTÊNCIA ANTES DE TUDO — inclusive antes da checagem de "PIX
    -- ligado": o retry de uma venda que JÁ nasceu recebe o pedido dela mesmo
    -- que a loja tenha desligado o PIX pelo app no meio do caminho.
    SELECT o.id, o.canal, o.vendedor_id, o.payment_method
      INTO v_order_id, v_canal_existente, v_vendedor_existente, v_metodo_existente
      FROM public.marketplace_orders o
     WHERE o.idempotency_key = p_idempotency_key;

    IF v_order_id IS NOT NULL THEN
        IF v_canal_existente IS DISTINCT FROM 'presencial'
           OR v_vendedor_existente IS DISTINCT FROM v_vendedor
           OR v_metodo_existente IS DISTINCT FROM 'online' THEN
            RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Esta chave de venda já foi usada por outro pedido.';
        END IF;
        v_ja_existia := true;
    END IF;

    IF NOT v_ja_existia THEN
        -- (3) VALIDAÇÃO. O PIX com QR é cobrado pela conta Mercado Pago da
        -- loja — a mesma chave que liga o PIX do site (`pagamento_online`,
        -- 20261174000000:246-269). Desligado, não há quem cobre.
        IF public.forma_de_pagamento_aceita('online') IS DISTINCT FROM true THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='O PIX pelo app está desligado nesta loja.';
        END IF;

        IF jsonb_typeof(p_itens) IS DISTINCT FROM 'array' OR jsonb_array_length(p_itens) = 0 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A venda precisa de pelo menos um item.';
        END IF;

        IF jsonb_array_length(p_itens) > 200 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Venda com itens demais.';
        END IF;

        v_desconto := round(COALESCE(p_desconto, 0), 2);
        IF v_desconto < 0 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='O desconto não pode ser negativo.';
        END IF;

        IF v_desconto > 0 AND NULLIF(btrim(COALESCE(p_observacao,'')),'') IS NULL THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Informe o motivo do desconto.';
        END IF;

        IF p_cliente_user_id IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_cliente_user_id) THEN
                RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Cliente não encontrado.';
            END IF;
        END IF;

        -- (4) PRIMEIRO LAÇO — travar e conferir (idêntico a 20261162000000:298-352).
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
                SELECT p.preco_venda, p.estoque, p.nome
                  INTO v_db_price, v_db_stock, v_item_name
                  FROM public.produtos p
                 WHERE p.id = v_product_id AND p.ativo = true AND p.deleted_at IS NULL
                   FOR NO KEY UPDATE;

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

        -- (5) TOTAL. Desconto maior que a venda é engano de digitação (falha
        -- fechada, como no balcão de sempre); total zero não vira cobrança —
        -- o Mercado Pago não gera PIX de R$ 0,00, e uma venda de graça não
        -- precisa de QR nenhum.
        IF v_desconto > v_subtotal THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='O desconto não pode ser maior que o subtotal da venda.';
        END IF;
        v_total := v_subtotal - v_desconto;
        IF v_total <= 0 THEN
            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Um PIX precisa de valor maior que zero.';
        END IF;

        -- (6) NOME DO CLIENTE (coluna NOT NULL — mesma regra de 20261162000000:367-371).
        v_customer_name := COALESCE(
            NULLIF(btrim(p_cliente_nome),''),
            (SELECT NULLIF(btrim(pr.full_name),'') FROM public.profiles pr WHERE pr.id = p_cliente_user_id),
            'Venda no balcão'
        );

        -- (7) CABEÇALHO: à espera do PIX. `expires_at` é a reserva de 30 min
        -- que a edge realinha com o vencimento real do QR, como no site.
        BEGIN
            INSERT INTO public.marketplace_orders (
                user_id, total, subtotal, shipping, discount,
                payment_method, metodo_online, status, payment_status, expires_at,
                vendedor_id, canal,
                customer_name, customer_data, notes, idempotency_key
            ) VALUES (
                p_cliente_user_id, v_total, v_subtotal, 0, v_desconto,
                'online', 'pix', 'pending', 'aguardando', now() + interval '30 minutes',
                v_vendedor, 'presencial',
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
                -- Corrida perdida para a requisição gêmea: devolve a dela, pela
                -- MESMA guarda do passo (2).
                SELECT o.id, o.canal, o.vendedor_id, o.payment_method
                  INTO v_order_id, v_canal_existente, v_vendedor_existente, v_metodo_existente
                  FROM public.marketplace_orders o
                 WHERE o.idempotency_key = p_idempotency_key;

                IF v_order_id IS NULL
                   OR v_canal_existente IS DISTINCT FROM 'presencial'
                   OR v_vendedor_existente IS DISTINCT FROM v_vendedor
                   OR v_metodo_existente IS DISTINCT FROM 'online' THEN
                    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Esta chave de venda já foi usada por outro pedido.';
                END IF;
                v_ja_existia := true;
        END;
    END IF;

    IF NOT v_ja_existia THEN
        -- (8) RESERVA DO ESTOQUE (baixa XOR + snapshot do item, idêntico a
        -- 20261162000000:424-478). Se ninguém pagar, `expirar_pedidos_vencidos`
        -- devolve pela `devolver_estoque`, a mesma de todo PIX do site.
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

            INSERT INTO public.marketplace_order_items (
                order_id, product_id, variant_id, quantity, price, product_name
            ) VALUES (
                v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price, v_item_name
            );
        END LOOP;

        -- (9) HISTÓRICO DO PEDIDO. Sem linha em payment_history (seção 6).
        INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
        VALUES (v_order_id, NULL, 'pending', 'Venda no balcão — aguardando o PIX', v_vendedor);
    END IF;

    -- (10) Mesmo formato de retorno de `registrar_venda_presencial`, nos dois
    -- caminhos (nasceu agora ou já existia).
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

REVOKE ALL ON FUNCTION public.iniciar_venda_presencial_pix(jsonb, uuid, uuid, text, text, numeric, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.iniciar_venda_presencial_pix(jsonb, uuid, uuid, text, text, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.iniciar_venda_presencial_pix(jsonb, uuid, uuid, text, text, numeric, text) IS 'PDV/balcão, PIX com QR: grava a venda presencial À ESPERA do PIX numa transação só — cabeçalho, itens e a RESERVA do estoque (baixa XOR), com preço do banco. Só admin (is_admin()), vendedor = auth.uid(), exige PIX pelo app ligado. Nasce canal=presencial, status=pending, payment_status=aguardando, payment_method=online, metodo_online=pix, expires_at=now()+30min. A cobrança é criada pela edge cobrar-pix-no-balcao; a confirmação é o caminho de sempre (confirmar_pagamento), e o gatilho tr_venda_do_balcao_paga_e_entregue marca a entrega. Chave obrigatória; repetida devolve o MESMO pedido (ja_existia=true); chave de outro canal, vendedor ou forma é 23505.';

-- ---------------------------------------------------------------------------
-- O gatilho: venda do balcão paga pelo PIX = entregue.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER porque a linha de histórico precisa nascer qualquer que
-- seja o caminho que confirmou o pagamento (a RPC `confirmar_pagamento`, que
-- já é definer, ou um UPDATE de admin pelo painel, que roda como
-- authenticated e não tem INSERT em marketplace_order_history). O corpo só
-- escreve em NEW e numa linha de histórico do MESMO pedido.
CREATE OR REPLACE FUNCTION public.venda_do_balcao_paga_e_entregue()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
    NEW.status := 'delivered';
    INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
    VALUES (NEW.id, 'pending', 'delivered', 'Venda no balcão — PIX confirmado', NULL);
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.venda_do_balcao_paga_e_entregue() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tr_venda_do_balcao_paga_e_entregue ON public.marketplace_orders;
CREATE TRIGGER tr_venda_do_balcao_paga_e_entregue
  BEFORE UPDATE OF payment_status ON public.marketplace_orders
  FOR EACH ROW
  WHEN (
    OLD.canal = 'presencial'
    AND OLD.payment_status = 'aguardando'
    AND NEW.payment_status = 'pago'
    AND OLD.status = 'pending'
    AND NEW.status = 'pending'
  )
  EXECUTE FUNCTION public.venda_do_balcao_paga_e_entregue();

COMMENT ON FUNCTION public.venda_do_balcao_paga_e_entregue() IS 'Gatilho do PIX do balcão (20261184000000): pedido canal=presencial que sai de aguardando para pago ainda pending vira delivered na MESMA linha e ganha uma linha de histórico. Não toca dinheiro, estoque nem payment_status; pago_apos_expirar e pedido cancelado não passam (condições no WHEN do gatilho).';
