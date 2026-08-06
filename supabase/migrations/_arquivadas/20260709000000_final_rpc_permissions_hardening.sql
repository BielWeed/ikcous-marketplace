-- Migration: Final RPC Permissions Hardening
-- Date: 2026-07-09
-- Version: 20260709000000

BEGIN;

-- 1. Revogar privilégio EXECUTE de funções internas e de triggers
-- Essas funções NUNCA devem ser chamadas diretamente via PostgREST RPC por clientes externos (anon ou authenticated).
-- Elas devem rodar apenas dentro do contexto de triggers ou pelo superusuário (service_role).

REVOKE EXECUTE ON FUNCTION public.ensure_role_protection() FROM PUBLIC,
ANON,
AUTHENTICATED;
REVOKE EXECUTE ON FUNCTION public.handle_default_address() FROM PUBLIC,
ANON,
AUTHENTICATED;
REVOKE EXECUTE ON FUNCTION public.handle_new_otp_verification() FROM PUBLIC,
ANON,
AUTHENTICATED;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC,
ANON,
AUTHENTICATED;
REVOKE EXECUTE ON FUNCTION public.handle_order_item_stock() FROM PUBLIC,
ANON,
AUTHENTICATED;
REVOKE EXECUTE ON FUNCTION public.handle_profile_role_sync_to_auth() FROM PUBLIC,
ANON,
AUTHENTICATED;
REVOKE EXECUTE ON FUNCTION public.handle_public_profile_sync() FROM PUBLIC,
ANON,
AUTHENTICATED;
REVOKE EXECUTE ON FUNCTION public.prevent_role_change() FROM PUBLIC,
ANON,
AUTHENTICATED;
REVOKE EXECUTE ON FUNCTION public.tr_prevent_role_change() FROM PUBLIC,
ANON,
AUTHENTICATED;
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC,
ANON,
AUTHENTICATED;
REVOKE EXECUTE ON FUNCTION public.clean_expired_shipping_quotes() FROM PUBLIC,
ANON,
AUTHENTICATED;
REVOKE EXECUTE ON FUNCTION public.clean_old_shipping_logs() FROM PUBLIC,
ANON,
AUTHENTICATED;


-- 2. Revogar privilégio EXECUTE para público/anônimo de funções administrativas recriadas ou otimizadas
-- Usuários administradores logados (que herdam o papel 'authenticated' via JWT) precisam poder chamá-las,
-- mas usuários anônimos (anon/PUBLIC) NUNCA devem ter permissão de execução sobre elas.

REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_v2(integer) FROM PUBLIC,
ANON;
REVOKE EXECUTE ON FUNCTION public.get_admin_orders_paged(
    text, text, text, text, integer, integer
) FROM PUBLIC,
ANON;
REVOKE EXECUTE ON FUNCTION public.get_admin_products_paged(
    text, text, text, text, integer, integer
) FROM PUBLIC,
ANON;
REVOKE EXECUTE ON FUNCTION public.get_admin_customers_paged(
    text, text, text, integer, integer
) FROM PUBLIC,
ANON;
REVOKE EXECUTE ON FUNCTION public.get_admin_questions_paged(
    text, text, integer, integer
) FROM PUBLIC,
ANON;
REVOKE EXECUTE ON FUNCTION public.get_admin_reviews_paged(
    text, text, integer, integer
) FROM PUBLIC,
ANON;
REVOKE EXECUTE ON FUNCTION public.check_is_admin() FROM PUBLIC, ANON;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, ANON;

-- Também garantir que a versão sem argumentos de get_admin_analytics_v2 (se ainda existir) esteja protegida
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'get_admin_analytics_v2' 
        AND oidvectortypes(proargtypes) = ''
    ) THEN
        EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_v2() FROM PUBLIC, anon;';
    END IF;
END
$$;

COMMIT;
