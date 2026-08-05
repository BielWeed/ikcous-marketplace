-- =============================================================================
-- update_order_status_atomic: checagem de dono à prova de NULL (PEDIDO-010, #115)
-- =============================================================================
--
-- PROBLEMA
--   Pedido de convidado é gravado com user_id NULL (create_marketplace_order_v23
--   faz `v_user_id := auth.uid()`, que é NULL para quem não tem sessão). A
--   checagem de dono usava `!=`, e em SQL `NULL != <uuid>` avalia para NULL, não
--   para true. O IF nunca disparava e a exceção de autorização nunca acontecia.
--
--   O alcance é maior do que "usuário logado cancela pedido de convidado". A
--   função tem GRANT EXECUTE para `anon` (20260707000000:94), e `<uuid> != NULL`
--   também dá NULL — então um visitante ANÔNIMO, de posse do id de um pedido de
--   cliente CADASTRADO, passava pela checagem do mesmo jeito. Em ambos os casos
--   o unico limite era o bloco seguinte, que restringe não-admin a cancelar
--   pedido pendente. Cancelar devolve o estoque, então a venda era desfeita de
--   verdade.
--
--   O id do pedido não é segredo: aparece na tela de sucesso, no rastreio e em
--   qualquer print que o cliente compartilhe.
--
-- SOLUÇÃO, em duas partes
--   1. Nenhuma alteração de status sem sessão. A checagem de `v_caller_id IS
--      NULL` vem ANTES do SELECT do pedido, de propósito: assim o anônimo recebe
--      'não autorizado' em vez de 'pedido não encontrado', e não consegue usar a
--      RPC para descobrir quais ids existem.
--   2. `IS DISTINCT FROM` no lugar de `!=`, que é a comparação que trata NULL
--      como valor em vez de propagar NULL.
--
--   Só a parte 1 já barraria o anônimo, e só a parte 2 já barraria o logado
--   contra pedido de convidado. As duas juntas fecham os quatro cruzamentos de
--   (chamador com/sem sessão) x (pedido com/sem dono).
--
-- ALÉM DO CRITÉRIO DE ACEITE, e de propósito
--   As outras comparações do corpo também eram `!=` sobre valores que podem ser
--   NULL. `p_new_status` vem do cliente: com NULL, `p_new_status != 'cancelled'`
--   dava NULL, o IF não disparava e um não-admin escrevia status NULL no pedido.
--   Trocadas por `IS DISTINCT FROM` no mesmo movimento — é o mesmo defeito, na
--   mesma função, e o corpo já está sendo substituído inteiro. Para valores não
--   nulos as duas formas são equivalentes, então nenhum chamador legítimo muda
--   de comportamento.
--
-- POR QUE `CREATE OR REPLACE` E NÃO `DROP` + `CREATE`
--   A migration de origem (20260707000000) usou DROP e teve de repetir os dois
--   GRANTs no fim. REPLACE preserva o pg_proc.proacl, então não há janela em que
--   a função exista sem o EXECUTE e o painel do admin quebre. O ACL fica como
--   está, `anon` incluído: quem autoriza passa a ser a guarda, não o GRANT.
--
-- IMPACTO NO FRONT, tratado no mesmo PR
--   O convidado que rastreia o pedido pelo OTP chega em OrderDetailsView (o
--   fallback de sessionStorage em :131) e via o botão "Cancelar Pedido", que só
--   dependia de `status === 'pending'`. Esse autocancelamento funcionava por
--   causa deste bug. O botão passa a exigir sessão — senão o cliente clicaria
--   num botão que agora sempre falha.
-- =============================================================================

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
        IF v_old_status IS DISTINCT FROM 'pending' THEN
            RAISE EXCEPTION 'Apenas pedidos pendentes podem ser cancelados pelo usuário.';
        END IF;
    END IF;

    -- STOCK RESTORATION LOGIC
    -- If transitioning to 'cancelled' from a non-cancelled status
    IF p_new_status = 'cancelled' AND v_old_status IS DISTINCT FROM 'cancelled' THEN
        FOR v_item IN SELECT product_id, variant_id, quantity FROM public.marketplace_order_items WHERE order_id = p_order_id
        LOOP
            IF v_item.variant_id IS NOT NULL THEN
                UPDATE public.product_variants
                SET stock_increment = stock_increment + v_item.quantity
                WHERE id = v_item.variant_id;
            ELSE
                UPDATE public.produtos
                SET estoque = estoque + v_item.quantity
                WHERE id = v_item.product_id;
            END IF;
        END LOOP;
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
