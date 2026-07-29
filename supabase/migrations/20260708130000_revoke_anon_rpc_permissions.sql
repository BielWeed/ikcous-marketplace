-- Migration: Revoke Anon RPC Execution Permissions for Admin and User Functions
-- Date: 2026-07-08
-- Version: 20260708130000

BEGIN;

-- Systematically revoke execute privileges from 'anon' and 'PUBLIC' on administrative and user-restricted SECURITY DEFINER functions.
-- This ensures unauthenticated guest users cannot call these RPCs directly via PostgREST.

-- 1. Admin-only functions (Revoke from anon, PUBLIC)
REVOKE EXECUTE ON FUNCTION public.get_sales_analytics(
    timestamp without time zone, timestamp without time zone
) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_customer_intelligence() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_retention_rate() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_coupon_stats() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.swap_banner_order(uuid, uuid) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_inventory_health() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.upsert_store_config(jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_category_sales(text, text) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_retention_analytics(integer) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_admin_user_detail(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_admin_executive_summary() FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.answer_question_atomic(uuid, text) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.answer_question_atomic(
    uuid, text, uuid
) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.decrement_stock(uuid, integer) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_stats() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_summary() FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_admin_list_paginated(
    text, integer, integer, text, text
) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_product_optimization_data() FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_product_stats() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_retention_analytics() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_sales_analytics(
    timestamp with time zone, timestamp with time zone
) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.reply_review_atomic(uuid, text) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.reply_review_atomic(
    uuid, text, uuid
) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_v2() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_segmented_push_targets(
    text, numeric, integer
) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_admin_customers_paged(
    text, text, text, integer, integer
) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_category_analytics(
    timestamp with time zone, timestamp with time zone
) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_admin_orders_paged(
    text, text, text, text, integer, integer
) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_admin_products_paged(
    text, text, text, text, integer, integer
) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_admin_reviews_paged(
    text, text, integer, integer
) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.update_order_status_atomic(
    uuid, text, text, boolean
) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.get_admin_questions_paged(
    text, text, integer, integer
) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.check_is_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, public;


-- 2. User-only functions (Revoke from anon, PUBLIC)
REVOKE EXECUTE ON FUNCTION public.get_my_complete_profile() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sync_cart_atomic(jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.update_my_profile_secure(
    text, text, text, text
) FROM anon,
public;
REVOKE EXECUTE ON FUNCTION public.record_vor_action(
    text, jsonb, jsonb, text
) FROM anon,
public;

COMMIT;
