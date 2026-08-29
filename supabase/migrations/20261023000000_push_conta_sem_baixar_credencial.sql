-- A tela de Push passa a medir público com uma função que devolve CONTA,
-- sem baixar credencial de envio nenhuma.
--
-- O defeito (laudo "o que falta" 29/08, achado config 18, latente — gatilho:
-- primeira loja com centenas de inscrições): para mostrar os três números
-- dos segmentos e a previsão de alcance, a tela chamava
-- `get_segmented_push_targets` 4 vezes e fazia `.length` no resultado. A
-- função devolve a LINHA INTEIRA de `push_subscriptions` — `auth`, `endpoint`,
-- `p256dh`, `user_id` — a credencial de envio de cada aparelho. Dado
-- sensível atravessando a rede a cada abertura de tela só para virar um
-- número. Hoje, com 8 inscrições, ninguém sente; o custo é latência e
-- exposição desnecessária, e cresce com a base.
--
-- A função nova replica os CINCO ramos da original (observada VIVA em
-- 29/08/2026 por pg_get_functiondef: uuid exato, vip com dinheiro
-- reconhecido e LTV >= p_min_ltv, inactive >= p_days_inactive, new = últimos
-- 7 dias, all = tudo) e devolve só `COUNT(*)`. Mesma assinatura de
-- parâmetros e mesmos DEFAULTS (150 / 30) — quem chama a original com um
-- segmento chama esta do mesmo jeito.
--
-- SECURITY DEFINER + guarda is_admin: idêntico à original (o COUNT
-- atravessa as mesmas tabelas). Nenhuma coluna de `push_subscriptions`
-- sai da função: só um número.
--
-- SEM BEGIN/COMMIT (regra da casa). NÃO aplicar sem prova e sem o Gabriel
-- autorizar NESTA sessão.
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (rodar contra o banco; nao rodada por
-- este agente):
--
--   -- 1. A conta da função nova BATE com o tamanho da lista da original,
--   --    segmento a segmento (a original continua existindo para o ENVIO):
--   SELECT
--     (SELECT count(*) FROM get_segmented_push_targets('vip'))      AS alvos_vip,
--     get_segmented_push_count('vip')                               AS conta_vip,
--     (SELECT count(*) FROM get_segmented_push_targets('inactive')) AS alvos_ina,
--     get_segmented_push_count('inactive')                          AS conta_ina,
--     (SELECT count(*) FROM get_segmented_push_targets('new'))      AS alvos_new,
--     get_segmented_push_count('new')                               AS conta_new,
--     (SELECT count(*) FROM get_segmented_push_targets('all'))      AS alvos_all,
--     get_segmented_push_count('all')                               AS conta_all;
--     -> espera alvos_* = conta_* em todos os pares
--
--   -- 2. Nenhuma coluna de credencial no retorno:
--   SELECT * FROM get_segmented_push_count('all');
--     -> espera UMA coluna (get_segmented_push_count), um número
--
--   -- 3. Guarda de admin (controle de segurança):
--   SET ROLE anon;
--   SELECT get_segmented_push_count('all');
--     -> espera EXCEPTION 'Acesso negado...'

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_segmented_push_count(
    p_segment text DEFAULT 'all'::text,
    p_min_ltv numeric DEFAULT 150,
    p_days_inactive integer DEFAULT 30
)
RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- Authorization check (igual à original)
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- Case 1: Specific User (UUID format)
    IF p_segment ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        RETURN (SELECT COUNT(*)
        FROM public.push_subscriptions s
        WHERE s.user_id = p_segment::uuid);

    -- Case 2: VIP Segment (Users with recognized-money LTV >= p_min_ltv)
    ELSIF p_segment = 'vip' THEN
        RETURN (SELECT COUNT(*)
        FROM public.push_subscriptions s
        WHERE s.user_id IN (
            SELECT o.user_id
            FROM public.marketplace_orders o
            WHERE o.status NOT IN ('cancelled', 'returned')
            AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
            GROUP BY o.user_id
            HAVING SUM(o.total::numeric) >= p_min_ltv
        ));

    -- Case 3: Inactive Segment (Inactive for >= p_days_inactive)
    ELSIF p_segment = 'inactive' THEN
        RETURN (SELECT COUNT(*)
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
        ));

    -- Case 4: New Clients Segment (Created within the last 7 days)
    ELSIF p_segment = 'new' THEN
        RETURN (SELECT COUNT(*)
        FROM public.push_subscriptions s
        WHERE s.user_id IN (
            SELECT p.id
            FROM public.profiles p
            WHERE p.created_at >= NOW() - INTERVAL '7 days'
        ));

    -- Case 5: All (Default fallback)
    ELSE
        RETURN (SELECT COUNT(*) FROM public.push_subscriptions s);
    END IF;
END;
$$;
