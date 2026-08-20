-- O segmento "Clientes Frequentes" (vip) do disparo de Push passa a definir
-- "quem gastou muito" pela mesma regra de dinheiro reconhecido que o resto
-- do painel já usa (achado de revisão sobre o commit d821611, 24/08/2026).
--
-- O DEFEITO, MEDIDO NA FONTE
--   d821611 corrigiu o "LTV Total" da tela de Clientes para só contar
--   `status NOT IN ('cancelled', 'returned') AND (payment_status IS NULL OR
--   payment_status IN ('pago', 'pago_apos_expirar'))` — a mesma regra que a
--   migration 20260822000100 já tinha posto em nove pontos do painel
--   analítico. Mas o ramo 'vip' de `get_segmented_push_targets` ficou para
--   trás: soma `o.total` de todo pedido não cancelado/devolvido, sem olhar
--   `payment_status`. Todo pedido nasce `status='pending'` +
--   `payment_status='aguardando'` com 30 minutos para ser pago — um cliente
--   com um PIX nunca pago entra na soma como se já tivesse gasto o dinheiro,
--   e pode acabar dentro de "Clientes Frequentes" mesmo com LTV reconhecido
--   igual a zero. Depois de d821611 as duas telas do mesmo painel discordam:
--   a de Clientes mostra R$ 0,00 para esse cliente; a de Push manda o
--   disparo de "cliente frequente" para ele mesmo assim.
--
-- A REGRA, A MESMA DE 20260822000100 E 20260823000000 — NÃO É REGRA NOVA
--   status NOT IN ('cancelled', 'returned')
--   AND (payment_status IS NULL OR payment_status IN ('pago', 'pago_apos_expirar'))
--
--   payment_status IS NULL CONTA, de propósito: NULL significa "sem cobrança
--   online" (pedido pago na entrega, pedido histórico), não "não pago". Ficam
--   de fora 'aguardando', 'recusado', 'expirado' e 'estornado'.
--
-- ONDE O PREDICADO ENTRA, E POR QUÊ
--   No WHERE do subselect do ramo 'vip', junto do `o.status NOT IN (...)`
--   que já estava lá — não dentro de um CASE no HAVING/SUM. A diferença
--   importa para quem tem pedido pago e pendente misturados: filtrar no
--   WHERE remove a linha pendente ANTES do GROUP BY, então o SUM(o.total)
--   do HAVING só soma o que sobrou pago; filtrar só no HAVING (com CASE
--   dentro do SUM) chegaria ao mesmo número aqui, mas por um caminho mais
--   longo sem necessidade. A razão de 20260823000000 ter usado CASE dentro
--   do SUM, em vez de WHERE, foi preservar `orders_count` e
--   `last_order_date` — duas métricas que vinham do MESMO FROM/WHERE que o
--   dinheiro, e que não podiam mudar de comportamento. Este subselect não
--   tem essa segunda métrica: ele só devolve `o.user_id` para alimentar um
--   HAVING de soma, então filtrar no WHERE é o corte mínimo e não há nada
--   mais para proteger.
--
-- O QUE NÃO MUDA
--   Assinatura (p_segment, p_min_ltv, p_days_inactive), tipo de retorno,
--   SECURITY DEFINER, SET search_path, a guarda is_admin() no topo. Os
--   ramos 'inactive' e 'new' decidem por DATA (último pedido, data de
--   cadastro), não por dinheiro — não têm este defeito e não são tocados.
--   O ramo de cliente específico (regex de UUID) e o 'all' (fallback)
--   também ficam intocados.
--
-- Sem BEGIN/COMMIT, de propósito: com eles o ROLLBACK do script de prova
-- vira no-op e a mudança fica gravada mesmo assim.
-- Prova: node scripts/db-prove-cliente-frequente-dinheiro-real.cjs

CREATE OR REPLACE FUNCTION public.get_segmented_push_targets(p_segment text DEFAULT 'all'::text, p_min_ltv numeric DEFAULT 150, p_days_inactive integer DEFAULT 30)
 RETURNS TABLE(auth text, endpoint text, p256dh text, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- Case 1: Specific User (UUID format)
    IF p_segment ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s
        WHERE s.user_id = p_segment::uuid;

    -- Case 2: VIP Segment (Users with recognized-money LTV >= p_min_ltv)
    ELSIF p_segment = 'vip' THEN
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s
        WHERE s.user_id IN (
            SELECT o.user_id
            FROM public.marketplace_orders o
            WHERE o.status NOT IN ('cancelled', 'returned')
            AND (o.payment_status IS NULL OR o.payment_status IN ('pago', 'pago_apos_expirar'))
            GROUP BY o.user_id
            HAVING SUM(o.total::numeric) >= p_min_ltv
        );

    -- Case 3: Inactive Segment (Inactive for >= p_days_inactive)
    ELSIF p_segment = 'inactive' THEN
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s
        WHERE s.user_id IN (
            -- Users whose last order was more than X days ago
            SELECT o.user_id
            FROM public.marketplace_orders o
            GROUP BY o.user_id
            HAVING MAX(o.created_at) < NOW() - (p_days_inactive || ' days')::interval
        ) OR s.user_id IN (
            -- Users who registered more than X days ago and have never ordered
            SELECT p.id
            FROM public.profiles p
            LEFT JOIN public.marketplace_orders o ON o.user_id = p.id
            WHERE p.created_at < NOW() - (p_days_inactive || ' days')::interval
              AND o.id IS NULL
        );

    -- Case 4: New Clients Segment (Created within the last 7 days)
    ELSIF p_segment = 'new' THEN
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s
        WHERE s.user_id IN (
            SELECT p.id
            FROM public.profiles p
            WHERE p.created_at >= NOW() - INTERVAL '7 days'
        );

    -- Case 5: All (Default fallback)
    ELSE
        RETURN QUERY
        SELECT s.auth, s.endpoint, s.p256dh, s.user_id
        FROM public.push_subscriptions s;
    END IF;
END;
$function$;
