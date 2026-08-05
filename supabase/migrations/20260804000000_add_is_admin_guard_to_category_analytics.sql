-- =============================================================================
-- get_category_analytics ganha a guarda de is_admin() (BANCO-020, issue #103)
-- =============================================================================
--
-- PROBLEMA
--   A função é SECURITY DEFINER — roda com o dono, ignorando o RLS de
--   marketplace_orders, marketplace_order_items e produtos — e não tinha
--   nenhuma checagem de quem chamou. O EXECUTE está concedido a `authenticated`.
--   Resultado: qualquer pessoa que criasse conta na loja extraía o faturamento
--   consolidado por categoria, o número de pedidos, o ticket médio e o total
--   arrecadado em frete, usando o mesmo cliente Supabase da vitrine.
--
--   Verificado no banco vivo em 30/07/2026 (achado #61 da auditoria de 29/07):
--   prosecdef = true, ACL 'authenticated=X/postgres', e o corpo ia de BEGIN
--   direto para RETURN QUERY, sem nenhuma ocorrência de is_admin.
--
-- SOLUÇÃO
--   O mesmo bloco de guarda que as outras RPCs administrativas já usam
--   (20240304000000_fix_admin_rpcs_auth.sql:12,
--   20260226100000_restore_customers_rpc.sql:21,
--   20260308000000_security_gold_standard.sql:28). Nada além disso muda: o corpo
--   da consulta é idêntico ao de 20260704170000_reconcile_category_analytics_frete.sql.
--
-- POR QUE `CREATE OR REPLACE` E NÃO `DROP` + `CREATE`
--   DROP derruba junto os GRANTs. A função voltaria sem o EXECUTE para
--   `authenticated`, e o dashboard do admin — que chama pelo mesmo papel —
--   quebraria na hora. Com REPLACE o pg_proc.proacl é preservado; a guarda passa
--   a ser a autorização, e não o GRANT.
--
--   REPLACE exige assinatura idêntica (mesmos nomes e tipos de argumento, mesmo
--   RETURNS TABLE). Se o corpo vivo tiver divergido do arquivo, este comando
--   falha em vez de aplicar algo torto — e o db-apply.cjs faz ROLLBACK.
--
-- IMPACTO NO FRONT
--   Os dois únicos call sites são src/hooks/useAnalytics.ts:354 e :385, ambos
--   alcançados só por AdminLayout e AdminDashboardView. Nenhuma tela de cliente
--   chama esta RPC.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_category_analytics(
    start_date timestamp with time zone, end_date timestamp with time zone
)
RETURNS TABLE (name text, value numeric, orders bigint, avg_ticket numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Guarda de autorização: SECURITY DEFINER ignora o RLS das três tabelas
    -- abaixo, então quem autoriza é esta linha.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    RETURN QUERY
    WITH category_sums AS (
        SELECT
            COALESCE(p.categoria, 'Geral')::text as name,
            SUM(oi.price * oi.quantity)::numeric as value,
            COUNT(DISTINCT o.id)::bigint as orders,
            CASE
                WHEN COUNT(DISTINCT o.id) > 0 THEN
                    ROUND((SUM(oi.price * oi.quantity) / COUNT(DISTINCT o.id))::numeric, 2)
                ELSE 0
            END as avg_ticket
        FROM public.marketplace_order_items oi
        JOIN public.produtos p ON oi.product_id = p.id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        WHERE o.created_at >= start_date AND o.created_at <= end_date
          AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY COALESCE(p.categoria, 'Geral')

        UNION ALL

        SELECT
            'Frete'::text as name,
            SUM(o.shipping)::numeric as value,
            COUNT(DISTINCT o.id)::bigint as orders,
            CASE
                WHEN COUNT(DISTINCT o.id) > 0 THEN
                    ROUND((SUM(o.shipping) / COUNT(DISTINCT o.id))::numeric, 2)
                ELSE 0
            END as avg_ticket
        FROM public.marketplace_orders o
        WHERE o.created_at >= start_date AND o.created_at <= end_date
          AND o.status NOT IN ('cancelled', 'returned')
          AND COALESCE(o.shipping, 0) > 0
    )
    SELECT cs.name, cs.value, cs.orders, cs.avg_ticket
    FROM category_sums cs
    ORDER BY cs.value DESC;
END;
$$;
