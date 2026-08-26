-- Cancelamento com estorno — passo 1: a regra, sem mover dinheiro.
--
-- Regra do Gabriel (24/08/2026): o divisor e' se o produto SAIU, nao se foi
-- pago. Pedido nao enviado (pending/processing) ou ja enviado (shipping)
-- podem ser cancelados pelo cliente; entregue (delivered) nao pode — produto
-- entregue e' devolucao, que e' outro assunto e outra decisao dele.
--
-- Quando o produto ja saiu, o ESTOQUE nao volta na hora do cancelamento —
-- ele ja esta fisicamente com o cliente. So volta quando o lojista confirmar
-- que o produto voltou, pela nova RPC confirmar_retorno_do_produto.
--
-- A lista de "estorno devido" fica FORA desta migration: e' derivada em
-- codigo do app a partir de status/payment_status/cancelled_after_shipping/
-- returned_to_seller_at, nao gravada em tabela nenhuma.
--
-- Sem BEGIN/COMMIT de proposito: com eles o ROLLBACK do script de prova
-- vira no-op e a mudanca fica gravada no banco mesmo assim.
--
-- AVISO: a premissa escrita em confirmar_pagamento
-- (20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql, l.526-534)
-- envelheceu. La esta escrito que "'cancelled' implica «estoque ja
-- voltou»" -- e isso passa a ser FALSO para um pedido cancelado depois do
-- envio (cancelled_after_shipping = true): o estoque so' volta quando o
-- lojista confirmar o retorno, pela RPC confirmar_retorno_do_produto desta
-- migration. Aquele arquivo NAO e' editado aqui -- migration aplicada nao
-- se altera --, mas quem for mexer em confirmar_pagamento precisa saber
-- que a premissa dela nao cobre mais todo pedido 'cancelled'.

-- 1. As duas colunas novas em marketplace_orders -----------------------------
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS cancelled_after_shipping boolean NOT NULL DEFAULT false;

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS returned_to_seller_at timestamptz;

COMMENT ON COLUMN public.marketplace_orders.cancelled_after_shipping IS
  'true quando o pedido foi cancelado ja em status shipping. HISTORICO: nunca volta a false. E o que faz o estorno e o estoque esperarem o produto voltar.';

COMMENT ON COLUMN public.marketplace_orders.returned_to_seller_at IS
  'quando o lojista confirmou que o produto voltou a mao dele. NULL = ainda nao voltou. So a RPC confirmar_retorno_do_produto grava aqui, e e nesse instante que o estoque volta.';

-- 2. update_order_status_atomic: a regra de cancelamento respeita o envio ---
--    Corpo copiado de supabase/migrations/20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql
--    (l.279-364), alterado so' nos dois pontos que este plano manda.
CREATE OR REPLACE FUNCTION public.update_order_status_atomic(
    p_order_id uuid,
    p_new_status text,
    p_notes text DEFAULT NULL,
    p_silent boolean DEFAULT FALSE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_status TEXT;
    v_user_id UUID;
    v_caller_id UUID := auth.uid();
    v_is_admin BOOLEAN := public.is_admin();
    v_item RECORD;
    v_result jsonb;
BEGIN
    -- Antes de qualquer leitura: sem sessão, nem existência de pedido se revela.
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Não autorizado: é preciso estar autenticado para alterar um pedido.';
    END IF;

    -- Get current status and lock row
    SELECT status, user_id INTO v_old_status, v_user_id
    FROM public.marketplace_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF v_old_status IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Security checks
    -- IS DISTINCT FROM, não `!=`: pedido de convidado tem user_id NULL, e
    -- `NULL != <uuid>` avalia para NULL — o IF não dispararia.
    IF v_user_id IS DISTINCT FROM v_caller_id AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Não autorizado: Você não tem permissão para alterar este pedido.';
    END IF;

    IF NOT v_is_admin THEN
        IF p_new_status IS DISTINCT FROM 'cancelled' THEN
            RAISE EXCEPTION 'Operação não permitida: Usuários só podem cancelar seus próprios pedidos.';
        END IF;
        -- Regra do Gabriel (24/08/2026): o divisor e' se o produto SAIU, nao
        -- foi pago. Nao enviado e enviado podem ser cancelados; entregue nao —
        -- produto entregue e' devolucao, que e' outro assunto e outra decisao.
        IF v_old_status NOT IN ('pending', 'processing', 'shipping') THEN
            RAISE EXCEPTION 'Este pedido não pode mais ser cancelado por você.';
        END IF;
    END IF;

    -- Grava o que o app hoje ESQUECE ao cancelar: se o produto ja tinha saido.
    -- Sem isto, depois do cancelamento nao ha como saber se o estorno espera a
    -- mercadoria voltar. Nao existe tabela de historico de status neste banco.
    -- (v_old_status = 'shipping' e p_new_status = 'cancelled' ja garantem que
    -- os dois sao distintos -- sem clausula extra sobre isso.)
    IF p_new_status = 'cancelled'
       AND v_old_status = 'shipping' THEN
        UPDATE public.marketplace_orders
           SET cancelled_after_shipping = true
         WHERE id = p_order_id;
    END IF;

    -- STOCK RESTORATION LOGIC
    -- `v_old_status <> 'shipping'`: produto que ja saiu esta FISICAMENTE com o
    -- cliente. Devolver a prateleira aqui faria a loja vender uma peca que nao
    -- tem. O estoque desse caso volta em confirmar_retorno_do_produto.
    -- If transitioning to 'cancelled' from a non-cancelled status
    IF p_new_status = 'cancelled'
       AND v_old_status IS DISTINCT FROM 'cancelled'
       AND v_old_status IS DISTINCT FROM 'shipping' THEN
        -- Mesmo laco de public.devolver_estoque(uuid) (20260807000000), sem
        -- nada alem dele -- reusa a funcao em vez de manter uma terceira
        -- copia do mesmo invariante (IF/ELSE variante XOR produto).
        PERFORM public.devolver_estoque(p_order_id);

        -- A vaga do cupom NAO volta aqui (Rodada 4): ela so' volta na
        -- varredura devolver_cupons_de_pedidos_mortos(), depois que o PIX
        -- ja nao pode mais ser pago (expires_at + 24h). Devolver no momento
        -- do cancelamento e' exatamente o que abriu a janela das Rodadas 2 e
        -- 3 -- ver o cabecalho da migration 20260901000000.
    END IF;

    -- Update status
    UPDATE public.marketplace_orders
    SET status = p_new_status, updated_at = NOW()
    WHERE id = p_order_id
    RETURNING to_jsonb(public.marketplace_orders.*) INTO v_result;

    -- Log history
    INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
    VALUES (p_order_id, v_old_status, p_new_status, p_notes, v_caller_id);

    RETURN v_result;
END;
$$;

-- 3. confirmar_retorno_do_produto: so' o lojista aciona -----------------------
--    E' o que faz o estoque voltar quando a mercadoria enviada retorna a loja.
CREATE OR REPLACE FUNCTION public.confirmar_retorno_do_produto(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_cancelled_after_shipping BOOLEAN;
    v_returned_at TIMESTAMPTZ;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja confirma que o produto voltou.';
    END IF;

    SELECT status, cancelled_after_shipping, returned_to_seller_at
      INTO v_status, v_cancelled_after_shipping, v_returned_at
      FROM public.marketplace_orders
     WHERE id = p_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF NOT v_cancelled_after_shipping THEN
        RAISE EXCEPTION 'Este pedido não estava enviado quando foi cancelado: não há produto para voltar.';
    END IF;

    -- cancelled_after_shipping e' HISTORICO (nunca volta a false): se a loja
    -- reativou o pedido para outro status depois do cancelamento (ex.:
    -- 'delivered'), o produto NAO esta voltando -- esta entregue, na mao do
    -- cliente. Sem esta guarda a RPC ainda aceitava e creditava estoque
    -- fantasma. Medido: pedido cancelado-apos-envio reativado para
    -- 'delivered', estoque 499 -> 500 com o produto entregue.
    IF v_status IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'Este pedido não está mais cancelado: não há retorno para confirmar.';
    END IF;

    -- Idempotencia: sem isto, dois cliques dobram o estoque da loja.
    IF v_returned_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'ja_confirmado', true, 'returned_to_seller_at', v_returned_at);
    END IF;

    -- Mesmo laco de public.devolver_estoque(uuid) (20260807000000), sem nada
    -- alem dele -- reusa a funcao em vez de manter uma terceira copia do
    -- mesmo invariante (IF/ELSE variante XOR produto).
    PERFORM public.devolver_estoque(p_order_id);

    UPDATE public.marketplace_orders
       SET returned_to_seller_at = now()
     WHERE id = p_order_id;

    RETURN jsonb_build_object('ok', true, 'ja_confirmado', false);
END;
$$;

-- REVOKE FROM PUBLIC nao alcanca o GRANT explicito que o Supabase da a
-- `anon` por default privilege -- medido ao vivo (ACL trazia anon=X/postgres
-- mesmo depois do REVOKE ALL FROM PUBLIC). Nao e' escalada (a funcao barra
-- em is_admin()), mas a convencao da casa (devolver_uso_cupom,
-- 20260901000000) e' nomear anon e authenticated explicitamente.
REVOKE ALL ON FUNCTION public.confirmar_retorno_do_produto(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_retorno_do_produto(uuid) TO authenticated;

-- 4. devolver_cupons_de_pedidos_mortos: o WHERE ganha a mesma espera do -----
--    estoque. Corpo copiado caractere a caractere de
--    supabase/migrations/20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql
--    (l.611-675), alterado so' no WHERE do FOR.
--
--    O DEFEITO MEDIDO, sem esta clausula: cupom de uso unico, pedido "na
--    entrega" (create_marketplace_order_v23 -- nasce com expires_at NULL e
--    payment_status NULL), enviado e cancelado pelo cliente depois do envio
--    -- cancelled_after_shipping = true, estoque NAO volta (correto),
--    returned_to_seller_at continua NULL. O WHERE abaixo, ANTES desta
--    clausula, ja aceitava esse pedido na hora (expires_at IS NULL cai no
--    caminho v23; status/payment_status batem): a varredura devolvia a
--    vaga do cupom com o produto ainda na mao do cliente.
--
--    cancelled_after_shipping = false OR returned_to_seller_at IS NOT NULL:
--    os dois lados sao FATO REGISTRADO (nunca deduzido de status ou
--    payment_status) -- a mesma exigencia que ja governa
--    coupon_usage_returned nesta funcao. Pedido que nunca foi
--    cancelado-apos-envio (cancelled_after_shipping = false, o caso comum)
--    passa direto, como sempre passou. Pedido cancelado-apos-envio so' entra
--    quando o lojista ja registrou o retorno (confirmar_retorno_do_produto).
CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $devolver_cupons_mortos$
DECLARE
    v_pedido     RECORD;
    v_devolvidos integer := 0;
BEGIN
    -- FOR UPDATE SKIP LOCKED: mesma protecao de expirar_pedidos_vencidos --
    -- se dois ciclos deste cron se sobrepuserem, ou se confirmar_pagamento
    -- estiver processando o MESMO pedido neste instante (por exemplo, um
    -- pagamento tardio que acabou de chegar), quem perder a corrida pela
    -- linha pula e tenta de novo no proximo ciclo -- nunca decrementa duas
    -- vezes, nunca decrementa um pedido que acabou de ser pago.
    --
    -- coupon_id IS NOT NULL: so' pedido com cupom entra na varredura.
    --
    -- status = 'cancelled' AND payment_status IS DISTINCT FROM 'pago' AND
    -- payment_status IS DISTINCT FROM 'pago_apos_expirar': exatamente o
    -- conjunto dos quatro pontos de desfazimento que ANTES desta migration
    -- devolviam (ou reconsumiam) o uso do cupom -- ver o cabecalho desta
    -- migration para a prova de que este WHERE reproduz aquele conjunto sem
    -- deduzir nada alem do que confirmar_pagamento ja registra.
    --
    -- coupon_usage_returned = FALSE: o FATO registrado, nunca deduzido --
    -- e' isto que torna a operacao idempotente por construcao. Pedido
    -- pre-existente (criado antes desta migration) nasce FALSE pelo
    -- DEFAULT da coluna, e entra na varredura normalmente -- correto,
    -- porque nenhuma versao anterior desta migration jamais rodou em
    -- producao.
    --
    -- expires_at IS NULL OR expires_at < now() - interval '24 hours': o
    -- numero da casa (pagamentos_a_reconciliar, 20260808000100), a decisao
    -- do Gabriel de que "a vaga fica reservada enquanto o PIX estiver
    -- aberto". expires_at IS NULL NAO e' so residuo historico -- e' o
    -- caminho CORRENTE de todo pedido "na entrega" criado por
    -- create_marketplace_order_v23 (a via PADRAO do app, useOrders.ts:
    -- 1059-1061; a v24 so' entra com pagamento online): v23 nunca grava
    -- expires_at nem payment_status, entao NULL aqui significa "nunca
    -- houve PIX por este caminho" -- sem janela nenhuma para proteger.
    --
    -- cancelled_after_shipping = false OR returned_to_seller_at IS NOT
    -- NULL: acrescentada por esta migration (20260970000000) -- ver o
    -- comentario acima do CREATE. Sem ela, pedido cancelado-apos-envio sem
    -- o produto de volta liberava a vaga do cupom antes da hora.
    FOR v_pedido IN
        SELECT id
        FROM public.marketplace_orders
        WHERE coupon_id IS NOT NULL
          AND status = 'cancelled'
          AND payment_status IS DISTINCT FROM 'pago'
          AND payment_status IS DISTINCT FROM 'pago_apos_expirar'
          AND coupon_usage_returned = FALSE
          AND (expires_at IS NULL OR expires_at < now() - interval '24 hours')
          AND (cancelled_after_shipping = false OR returned_to_seller_at IS NOT NULL)
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.devolver_uso_cupom(v_pedido.id);

        UPDATE public.marketplace_orders
           SET coupon_usage_returned = TRUE
         WHERE id = v_pedido.id;

        v_devolvidos := v_devolvidos + 1;
    END LOOP;

    RETURN v_devolvidos;
END;
$devolver_cupons_mortos$;
