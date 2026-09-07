-- ============================================================================
-- ROLLBACK MANUAL — 2026110000200 (convergência de grants da loja clonada)
-- ============================================================================
-- ATENÇÃO: este rollback REABRE exatamente os 58 grants que a migration
-- fecha — devolve a Savy ao ACL FROUXO que ela tinha antes (a fotografia
-- medida em 08/09/2026, `acl-savy.json` da frente grants-da-loja-clonada).
--
-- ESTE ROLLBACK SÓ FAZ SENTIDO NA LOJA ONDE A MIGRATION MUDOU ALGO — isto é,
-- numa loja clonada como a Savy. NO PRINCIPAL, a migration é NO-OP (nenhum
-- destes GRANTs existia lá antes dela), então rodar este rollback no
-- principal DARIA grants que nunca existiram no banco de verdade — NÃO
-- RODAR LÁ.
--
-- Só executar se a migration causar dano comprovado na loja clonada, e
-- reaplicar a migration assim que o dano for tratado.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.answer_question_atomic(uuid,text,uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.answer_question_atomic(uuid,text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clean_expired_shipping_quotes() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clean_old_shipping_logs() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v22(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrement_stock(uuid,integer) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_role_protection() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_order_otp_v1(text,text,text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_products_internal() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_v2(integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_customers_paged(text,text,text,integer,integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_summary() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_executive_summary() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_list_paginated(text,integer,integer,text,text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_products_paged(text,text,text,text,integer,integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_questions_paged(text,text,integer,integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_reviews_paged(text,text,integer,integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_user_detail(uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_category_analytics(timestamp with time zone,timestamp with time zone) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_category_sales(text,text) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_coupon_stats() TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_intelligence() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_inventory_health() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_complete_profile() TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orders_by_whatsapp_v3(text,text,text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_optimization_data() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_recommendations(uuid,integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_stats() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_products_with_variants() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_retention_analytics() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_retention_rate() TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reviews_metrics(text,integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_analytics(timestamp with time zone,timestamp with time zone) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_segmented_push_targets(text,numeric,integer) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_default_address() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_order_item_stock() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_profile_role_sync_to_auth() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_public_profile_sync() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_updated_at() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_helpful(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevent_role_change() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_vor_action(text,jsonb,jsonb,text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reply_review_atomic(uuid,text,uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reply_review_atomic(uuid,text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.swap_banner_order(uuid,uuid) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_cart_atomic(jsonb) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tr_prevent_role_change() TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_profile_secure(text,text,text,text) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_status_atomic(uuid,text,text,boolean) TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_coupon_secure_v2(text,numeric) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_coupon_secure(text,numeric) TO PUBLIC, anon, authenticated;

-- Conferência do rollback (deve voltar tudo true):
--   SELECT has_function_privilege('anon','public.check_is_admin()','EXECUTE');
--   SELECT has_function_privilege('PUBLIC','public.is_admin()','EXECUTE');
