-- ============================================================================
-- ROLLBACK MANUAL — 20261091000000 (EXECUTE de RPCs órfãs + DROP de sobrecargas)
-- ============================================================================
-- ATENÇÃO: este rollback REABRE as portas que a migration fecha —
-- create_marketplace_order_v22 volta ao alcance de anon/authenticated (a
-- versão que grava total NULL nas colunas novas), v23/v24 voltam a ter
-- EXECUTE para PUBLIC, e as duas sobrecargas ambíguas (300 Multiple Choices
-- no PostgREST) renascem. Só executar se a migration causar dano comprovado,
-- e reaplicar a migration assim que o dano for tratado.
--
-- Estado restaurado: o ACL medido em 04/09 (db-inspect-blindagem-114.cjs) e
-- as definições das duas funções dropadas (fiéis ao pg_get_functiondef do
-- mesmo dia).
-- ============================================================================

-- 1. v22 volta ao alcance do app ----------------------------------------------
GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v22(
  p_items jsonb, p_total_amount numeric, p_shipping_cost numeric,
  p_payment_method text, p_address_id uuid, p_coupon_code text,
  p_customer_name text, p_customer_phone text, p_observation text,
  p_address_data jsonb)
TO anon, authenticated;

-- 2. v23/v24 voltam a ter PUBLIC -----------------------------------------------
GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v23(
  p_items jsonb, p_total_amount numeric, p_shipping_cost numeric,
  p_payment_method text, p_address_id uuid, p_coupon_code text,
  p_customer_name text, p_customer_phone text, p_observation text,
  p_address_data jsonb, p_destination_cep text, p_shipping_option_id text,
  p_idempotency_key uuid)
TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v24(
  p_items jsonb, p_total_amount numeric, p_shipping_cost numeric,
  p_payment_method text, p_address_id uuid, p_coupon_code text,
  p_customer_name text, p_customer_phone text, p_observation text,
  p_address_data jsonb, p_destination_cep text, p_shipping_option_id text,
  p_idempotency_key uuid)
TO PUBLIC;

-- 3. Sobrecargas dropadas renascem (corpo fiel de 04/09) ----------------------
CREATE OR REPLACE FUNCTION public.get_sales_analytics(start_date timestamp without time zone, end_date timestamp without time zone)
 RETURNS TABLE(day timestamp without time zone, orders bigint, revenue numeric, ticket numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT 
    sales_day,
    total_orders,
    gross_revenue::numeric,
    average_ticket::numeric
  FROM public.sales_overview
  WHERE sales_day >= start_date AND sales_day <= end_date;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_sales_analytics(timestamp without time zone, timestamp without time zone) TO authenticated, service_role;
-- Função recém-CREATE nasce com EXECUTE para PUBLIC (default do Postgres);
-- o estado pré-migration NÃO tinha PUBLIC — tira para ficar fiel.
REVOKE EXECUTE ON FUNCTION public.get_sales_analytics(timestamp without time zone, timestamp without time zone) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_retention_analytics(p_days integer DEFAULT 90)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_total_customers int;
    v_repeat_customers int;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    WITH customer_counts AS (
        SELECT 
            COALESCE(user_id::text, customer_data->>'whatsapp') as customer_id,
            COUNT(*) as order_count
        FROM marketplace_orders
        WHERE created_at >= NOW() - (p_days || ' days')::interval
        AND status NOT IN ('cancelled', 'returned')
        GROUP BY customer_id
    )
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE order_count > 1)
    INTO v_total_customers, v_repeat_customers
    FROM customer_counts;

    IF v_total_customers = 0 THEN
        RETURN 0;
    END IF;

    RETURN (v_repeat_customers::numeric / v_total_customers::numeric) * 100;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_retention_analytics(integer) TO authenticated, service_role;
-- Idem: tirar o PUBLIC de nascimento do CREATE.
REVOKE EXECUTE ON FUNCTION public.get_retention_analytics(integer) FROM PUBLIC;

-- 4. Órfãs voltam ao estado medido ----------------------------------------------
-- (ACL medido ao vivo função por função na revisão de 04/09 — cada linha
-- devolve EXATAMENTE o que o papel tinha antes da migration)
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO anon, authenticated;
-- decrement_stock tinha SÓ authenticated (o REVOKE de anon na migration foi no-op).
GRANT EXECUTE ON FUNCTION public.decrement_stock(p_id uuid, quantity integer) TO authenticated;
-- get_active_products_internal tinha SÓ postgres/service_role — nada a devolver.
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_executive_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_list_paginated(p_table_name text, p_page_size integer, p_page_number integer, p_search_query text, p_filter_status text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_category_sales(start_date text, end_date text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_intelligence() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inventory_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_optimization_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_products_with_variants() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon_secure(p_code text, p_subtotal numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_retention_analytics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_analytics(start_date timestamp with time zone, end_date timestamp with time zone) TO authenticated;

-- Conferência do rollback (deve voltar tudo true / funções presentes):
--   SELECT has_function_privilege('anon','public.create_marketplace_order_v22(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb)','EXECUTE');
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--     WHERE n.nspname='public' AND p.proname IN ('get_sales_analytics','get_retention_analytics');  -- 4
