-- ROLLBACK MANUAL da 2026110000000_o_estorno_nasce_no_ledger.sql
--
-- Desfaz, na ordem: (1) recria update_order_status_atomic com o corpo que
-- ela tinha ANTES desta migration — o corpo VIVO de 20261060000000, colado
-- byte a byte do pg_get_functiondef do banco (e' o que garante fidelidade;
-- escrita a mao divergiria em formatacao e a foto do db-prove-rollback
-- acusaria); (2) derruba a RPC solicitar_estorno; (3) derruba a tabela
-- order_refunds (indices, policies e comments caem junto); (4) derruba a
-- coluna marketplace_orders.valor_estornado (comment junto).
--
-- O QUE ELE NAO DESFAZ (e por que): linha de order_refunds nao existe em
-- banco nenhum antes da migration ter sido aplicada e usada — o rollback e'
-- para o momento "apliquei e me arrependi antes do uso"; se ja houver linha
-- gravada, o DROP TABLE apaga HISTORICO de devolucao: leia antes de derrubar.
--
-- SEM BEGIN/COMMIT (regra da casa — o ROLLBACK do script de prova vive).
--
-- Como conferir (tudo em transacao com ROLLBACK, nada grava):
--   node scripts/db-prove-rollback.cjs supabase/migrations/2026110000000_o_estorno_nasce_no_ledger.sql --rollback supabase/migrations/rollback-manual-2026110000000_o_estorno_nasce_no_ledger.sql
--   node scripts/db-prove-estorno-ledger.cjs   (a secao final "rollback:" da prova)

-- ============================================================================
-- 1. update_order_status_atomic volta ao corpo anterior (20261060000000)
--    (texto canônico do pg_get_functiondef — reaplicar produz o mesmo corpo)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_order_status_atomic(p_order_id uuid, p_new_status text, p_notes text DEFAULT NULL::text, p_silent boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_old_status TEXT;
    v_user_id UUID;
    v_caller_id UUID := auth.uid();
    v_is_admin BOOLEAN := public.is_admin();
    v_cancelled_after_shipping BOOLEAN;
    v_item RECORD;
    v_result jsonb;
BEGIN
    -- Antes de qualquer leitura: sem sessão, nem existência de pedido se revela.
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Não autorizado: é preciso estar autenticado para alterar um pedido.';
    END IF;

    -- Get current status and lock row
    SELECT status, user_id, cancelled_after_shipping INTO v_old_status, v_user_id, v_cancelled_after_shipping
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
    --
    -- `NOT v_cancelled_after_shipping` (laudo 0109, A8): pedido cancelado
    -- apos o envio que a loja REATIVA e re-cancela a partir de 'processing'
    -- e' o mesmo envio — a peca continua com o cliente, e creditar aqui era
    -- phantom. O credito desse pedido so existe em
    -- confirmar_retorno_do_produto (que agora carimba stock_returned_at, e
    -- por isso tambem so acontece uma vez).
    -- If transitioning to 'cancelled' from a non-cancelled status
    IF p_new_status = 'cancelled'
       AND v_old_status IS DISTINCT FROM 'cancelled'
       AND v_old_status IS DISTINCT FROM 'shipping'
       AND NOT v_cancelled_after_shipping THEN
        -- Mesmo laco de public.devolver_estoque(uuid) — reusa a funcao em vez
        -- de manter uma terceira copia do mesmo invariante (IF/ELSE variante
        -- XOR produto). Desde 20261060000000 a funcao e idempotente pelo fato
        -- (stock_returned_at): a oscilacao cancelled -> processing ->
        -- cancelled credita UMA vez, na primeira.
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
$function$;

-- Grants re-casados por garantia (o CREATE OR REPLACE preserva a ACL; o
-- estado alvo e' o de antes: EXECUTE so para authenticated).
REVOKE ALL ON FUNCTION public.update_order_status_atomic(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_status_atomic(uuid, text, text, boolean) TO authenticated;

-- ============================================================================
-- 2. A RPC nova some
-- ============================================================================

DROP FUNCTION IF EXISTS public.solicitar_estorno(uuid, numeric, text);

-- ============================================================================
-- 3. A tabela nova some (indices, policies e comments caem junto)
-- ============================================================================

DROP TABLE IF EXISTS public.order_refunds;

-- ============================================================================
-- 4. A coluna nova some (o COMMENT dela cai junto)
-- ============================================================================

ALTER TABLE public.marketplace_orders DROP COLUMN IF EXISTS valor_estornado;
