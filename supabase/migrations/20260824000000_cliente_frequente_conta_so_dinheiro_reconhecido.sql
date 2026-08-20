-- O segmento "Clientes Frequentes" (vip) do disparo de Push passa a definir
-- "quem gastou muito" pela mesma regra de dinheiro reconhecido que o resto
-- do painel já usa (achado de revisão sobre o commit d821611, 24/08/2026).
--
-- O DEFEITO, MEDIDO NA FONTE — E O QUE NÃO É
--   d821611 corrigiu o "LTV Total" da tela de Clientes para só contar
--   `status NOT IN ('cancelled', 'returned') AND (payment_status IS NULL OR
--   payment_status IN ('pago', 'pago_apos_expirar'))` — a mesma regra que a
--   migration 20260822000100 já tinha posto em nove pontos do painel
--   analítico. Mas o ramo 'vip' de `get_segmented_push_targets` ficou para
--   trás: soma `o.total` de todo pedido não cancelado/devolvido, sem olhar
--   `payment_status`.
--
--   Uma primeira leitura deste achado citava um caso concreto — "uma pessoa
--   com um PIX de R$ 214,40 nunca pago aparece com LTV R$ 0,00 e recebe o
--   disparo de Clientes Frequentes". Medido, só leitura, em 24/08/2026: ESSE
--   CASO NÃO EXISTE NESTE BANCO. R$ 214,40 é a receita de UM DIA somando 6
--   pedidos (cabeçalho de 20260822000100), não o valor de um PIX de uma
--   pessoa; e há só 1 dono de aparelho distinto entre as 8 assinaturas de
--   push cadastradas, o que já torna "uma pessoa recebendo o disparo por
--   engano" um fato que não pode estar acontecendo hoje. Com isso
--   confirmado, o efeito desta migration NESTE BANCO, HOJE, é ZERO clientes:
--   o conjunto devolvido pelo segmento 'vip' é idêntico antes e depois da
--   correção (provado no script abaixo, ponto a ponto).
--
--   O MECANISMO REAL — hipotético neste banco, mas real na forma como o app
--   funciona: todo pedido nasce `status='pending'` +
--   `payment_status='aguardando'`, e o PIX gerado no checkout tem cerca de
--   30 minutos de validade antes de expirar. Nessa janela — do clique em
--   "finalizar pedido" até a rotina de expiração cancelar o pedido — o
--   total do pedido já entra na soma do ramo 'vip', porque ele só filtra
--   por `status`, não por `payment_status`. Pedido já expirado
--   (`payment_status = 'expirado'`) já sai pelo filtro de status hoje,
--   porque a varredura de expiração cancela o pedido junto; o que sobrevive
--   ao filtro de status e ainda infla a soma é (a) a janela dos ~30 minutos
--   em que o pedido está pendente e ainda não expirou, e (b) qualquer
--   pedido `recusado`/`estornado` que porventura não cancele o pedido
--   junto. Numa loja com PIX ativo o dia inteiro, essa janela acontece o
--   dia inteiro, todo dia — é aí que o defeito deixa de ser hipotético: ele
--   se replica para toda loja clonada deste molde. Só não há, hoje, um
--   cliente deste banco de desenvolvimento parado dentro dela para servir
--   de exemplo concreto.
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
