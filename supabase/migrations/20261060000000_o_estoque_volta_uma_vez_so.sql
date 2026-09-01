-- O ESTOQUE VOLTA UMA VEZ SÓ (laudo novos ângulos 01/09, achado A8).
--
-- O DEFEITO: `update_order_status_atomic` devolvia estoque em TODA ida a
-- 'cancelled' vinda de status ≠ cancelled/shipping (20260970000000:115-128),
-- sem registro nenhum de "já devolvi". A oscilação
-- `cancelled → processing → cancelled` creditava a prateleira DUAS vezes —
-- e a porta não era só a RPC: a policy `marketplace_orders_admin_update_
-- policy` (baseline:5585) deixa um admin escrever `status` direto por
-- PostgREST, sem RPC nenhuma. O cupom já tinha a cura da casa — coluna-fato
-- `coupon_usage_returned` (Rodada 4, 20260901000000) —; o estoque não tinha
-- equivalente. Esta migration dá a ele a mesma família de cura.
--
-- O INVARIANTE FÍSICO que sustenta a guarda: o estoque de um pedido é
-- DEBITADO uma única vez, na criação (v23/v24). Logo, ele pode voltar à
-- prateleira NO MÁXIMO uma vez na vida do pedido. Qualquer segundo crédito
-- é peça fantasma. "Devolvido" passa a ser FATO REGISTRADO
-- (marketplace_orders.stock_returned_at), nunca deduzido de status/
-- payment_status — a mesma lição das quatro rodadas do cupom.
--
-- TRÊS MUDANÇAS, cada uma com o motivo:
--
--   1. Coluna nova `stock_returned_at` + BACKFILL: pedido 'cancelled' com
--      estoque já de volta ganha o carimbo (o momento é o melhor disponível:
--      returned_to_seller_at quando o retorno do envio foi confirmado, e
--      updated_at nos demais — a PRECISÃO do momento não importa, só o FATO
--      de não ser nulo; a coluna nunca é lida como data, só como
--      "preenchido"). Pedido 'cancelled' com `cancelled_after_shipping =
--      true` e `returned_to_seller_at IS NULL` NÃO é carimbado: a mercadoria
--      está fisicamente com o cliente e o crédito dele ainda vai acontecer
--      (e carimbar) em confirmar_retorno_do_produto.
--
--   2. `devolver_estoque` vira idempotente PELO FATO: reclama o carimbo com
--      `UPDATE ... WHERE stock_returned_at IS NULL ... RETURNING` e só
--      credita se ganhou a reclamação. Os chamadores de hoje (varredura de
--      expiração, confirmar_pagamento estornado/recusado,
--      confirmar_retorno_do_produto, update_order_status_atomic) chamam uma
--      vez só e não mudam de comportamento; a porta que não garantia
--      singularidade (a oscilação) fecha sozinha. O COMMENT da
--      20260807000000 dizia "não é idempotente, o chamador é responsável" —
--      o contrato sobe de nível e o COMMENT é reescrito.
--
--   3. `update_order_status_atomic` ganha `AND NOT cancelled_after_shipping`
--      no crédito: pedido cancelado DEPOIS DO ENVIO (mercadoria fora) que a
--      loja reativa e re-cancela a partir de 'processing' hoje credita
--      phantom — o produto está com o cliente. Com a guarda, o crédito
--      desse caso só existe em confirmar_retorno_do_produto (que carimba).
--
--   4. FECHA A PORTA DIRETA (defesa em profundidade): `REVOKE UPDATE` na
--      tabela + `GRANT UPDATE (tracking_code, notes)` para authenticated.
--      O painel escreve direto SÓ esses dois (prova por grep em 01/09:
--      OrderDetail.tsx:1236 e :1256 — nada mais em src/ escreve
--      marketplace_orders direto); todo o resto passa por SECURITY DEFINER
--      (dono postgres, imune a grant de coluna) ou service_role (grants
--      próprios, intocados). Com isso, mudança de status sem ser pela RPC
--      deixa de existir para cliente de aplicação — a oscilação nem chega a
--      disputar o crédito, porque nem acontece. anon também perde UPDATE
--      (não tinha policy nenhuma: era morto já, o revoke é cinta e suspensório).
--
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK da prova vira no-op;
-- o db-apply.cjs abre a transação).
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (contra o banco vivo):
--   -- 1. A coluna e o backfill:
--   SELECT
--     count(*) FILTER (WHERE status = 'cancelled'
--                       AND (cancelled_after_shipping = false
--                            OR returned_to_seller_at IS NOT NULL)
--                       AND stock_returned_at IS NULL) AS faltou_carimbo,
--     count(*) FILTER (WHERE status = 'cancelled'
--                       AND cancelled_after_shipping = true
--                       AND returned_to_seller_at IS NULL
--                       AND stock_returned_at IS NOT NULL) AS carimbou_sem_direito
--   FROM public.marketplace_orders;
--   -> espera as duas colunas = 0
--
--   -- 2. devolver_estoque devolve 0 na segunda chamada:
--   SELECT pg_get_functiondef('public.devolver_estoque(uuid)'::regprocedure)
--     LIKE '%stock_returned_at IS NULL%' AS eh_idempotente_pelo_fato;
--   -> espera true
--
--   -- 3. Grants de coluna:
--   SELECT privilege_type, column_name FROM information_schema.column_privileges
--    WHERE table_schema = 'public' AND table_name = 'marketplace_orders'
--      AND grantee = 'authenticated' AND privilege_type = 'UPDATE';
--   -> espera só tracking_code e notes
--
--   -- 4. A prova funcional completa (transacional, ROLLBACK no fim):
--   node scripts/db-prove-estoque-volta-uma-vez.cjs
--   -> espera todas as asserções verdes
--
-- ROLLBACK MANUAL: versionado em
-- rollback-manual-20261060000000_o_estoque_volta_uma_vez_so.sql
--
-- ⚠️ Revisão do par OBRIGATÓRIA antes de aplicar (RLS + caminho do dinheiro).

-- ============================================================================
-- 1. A coluna-fato e o backfill
-- ============================================================================

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS stock_returned_at timestamptz;

COMMENT ON COLUMN public.marketplace_orders.stock_returned_at IS
  'FATO registrado (nunca deduzido de status/payment_status): true-ish '
  '(preenchido) quando o estoque deste pedido já voltou à prateleira — e '
  'então nunca mais volta, porque foi debitado uma única vez, na criação. '
  'Guarda devolver_estoque desde 20261060000000 (laudo 0109, A8). Backfill: '
  'carimbado com returned_to_seller_at (retorno pós-envio) ou updated_at '
  '(demais cancelamentos) — a precisão do momento não importa, só o fato.';

UPDATE public.marketplace_orders
   SET stock_returned_at = COALESCE(returned_to_seller_at, updated_at, created_at)
 WHERE status = 'cancelled'
   AND (cancelled_after_shipping = false
        OR (cancelled_after_shipping = true AND returned_to_seller_at IS NOT NULL))
   AND stock_returned_at IS NULL;

-- ============================================================================
-- 2. devolver_estoque: o fato é reclamado aqui dentro — idempotente por
--    construção, qualquer que seja o chamador (hoje ou futuro)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.devolver_estoque(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $devolver$
DECLARE
    v_item     RECORD;
    v_unidades integer := 0;
    v_ganhou   boolean;
BEGIN
    -- Reclama o carimbo ANTES de creditar. Quem perder a corrida (ou quem
    -- chegar de novo — a oscilação de status, o reenvio do webhook, o duplo
    -- clique do lojista) recebe 0 sem tocar na prateleira. Dentro da mesma
    -- transação do chamador: se o chamador abortar depois, o carimbo volta
    -- junto (ROLLBACK), e a próxima tentativa honesta ainda credita.
    UPDATE public.marketplace_orders
       SET stock_returned_at = now()
     WHERE id = p_order_id
       AND stock_returned_at IS NULL
    RETURNING true INTO v_ganhou;

    IF v_ganhou IS NOT TRUE THEN
        RETURN 0;
    END IF;

    FOR v_item IN
        SELECT product_id, variant_id, quantity
        FROM public.marketplace_order_items
        WHERE order_id = p_order_id
    LOOP
        -- IF/ELSE, não dois IF: a v23 debita XOR (variante OU produto, nunca os
        -- dois), e o front manda product_id preenchido junto com variant_id. Com
        -- dois IF, todo pedido de variante que expirasse creditaria o produto pai
        -- também, inflando o catalogo para sempre. Mesma forma do restore que ja
        -- existe em update_order_status_atomic.
        IF v_item.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
               SET stock_increment = stock_increment + v_item.quantity
             WHERE id = v_item.variant_id;
        ELSE
            UPDATE public.produtos
               SET estoque = estoque + v_item.quantity
             WHERE id = v_item.product_id;
        END IF;

        v_unidades := v_unidades + v_item.quantity;
    END LOOP;

    RETURN v_unidades;
END;
$devolver$;

COMMENT ON FUNCTION public.devolver_estoque(uuid) IS
  'Idempotente desde 20261060000000 (laudo 0109, A8): credita o estoque do '
  'pedido NO MAXIMO uma vez na vida dele, guardado pela coluna-fato '
  'stock_returned_at (o estoque foi debitado uma vez so, na criacao — '
  'segundo credito e peça fantasma). Devolve 0 sem tocar na prateleira '
  'quando o carimbo ja existe. Antes desta migration o contrato era "nao e '
  'idempotente, o chamador garante chamada unica" (20260807000000) — a '
  'unica porta que nao garantia era a oscilacao cancelled -> processing -> '
  'cancelled, alcancavel inclusive por PostgREST direto de admin '
  '(baseline:5585). REVOKE de EXECUTE mantido (sao os donos das RPCs quem '
  'chamam).';

-- ============================================================================
-- 3. update_order_status_atomic: produto que SAIU não credita por
--    re-cancelamento — só por confirmar_retorno_do_produto
-- ============================================================================

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
$$;

-- ============================================================================
-- 4. Fecha a porta direta de status/payment por PostgREST (defesa em
--    profundidade — o fato da secao 2 ja segura o credito em dobro)
-- ============================================================================

-- O painel escreve direto SÓ tracking_code (OrderDetail.tsx:1236) e notes
-- (:1256) — prova por grep em 01/09/2026, único uso direto em src/. Status,
-- payment_status e cia passam OBRIGATORIAMENTE pelas SECURITY DEFINER
-- (dono postgres, imune a grant de coluna) ou pelo service_role (grants
-- próprios, intocados). anon não tinha policy de UPDATE nenhuma: o revoke
-- é cinta e suspensório.
REVOKE UPDATE ON TABLE public.marketplace_orders FROM anon;
REVOKE UPDATE ON TABLE public.marketplace_orders FROM authenticated;
GRANT UPDATE (tracking_code, notes) ON TABLE public.marketplace_orders TO authenticated;
