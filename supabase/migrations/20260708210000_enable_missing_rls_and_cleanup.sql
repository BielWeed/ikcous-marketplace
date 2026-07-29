-- Migration: 20260708210000_enable_missing_rls_and_cleanup.sql
-- Description: Enable missing Row Level Security (RLS) on active tables and drop legacy unused tables from gestaolojinha.

BEGIN;

-- 1. Enable RLS on active tables
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vor_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_ai_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- 2. Drop legacy unused tables from the previous gestaolojinha project
DROP TABLE IF EXISTS public.active_customers CASCADE;
DROP TABLE IF EXISTS public.active_users_count CASCADE;
DROP TABLE IF EXISTS public.alertas CASCADE;
DROP TABLE IF EXISTS public.avg_ticket CASCADE;
DROP TABLE IF EXISTS public.configuracoes CASCADE;
DROP TABLE IF EXISTS public.fluxo_caixa CASCADE;
DROP TABLE IF EXISTS public.fornecedores CASCADE;
DROP TABLE IF EXISTS public.historico_precos CASCADE;
DROP TABLE IF EXISTS public.kanban_cards CASCADE;
DROP TABLE IF EXISTS public.low_stock_count CASCADE;
DROP TABLE IF EXISTS public.metas CASCADE;
DROP TABLE IF EXISTS public.pedido_itens CASCADE;
DROP TABLE IF EXISTS public.pedidos CASCADE;
DROP TABLE IF EXISTS public.pending_count CASCADE;
DROP TABLE IF EXISTS public.retiradas CASCADE;
DROP TABLE IF EXISTS public.rev_history CASCADE;
DROP TABLE IF EXISTS public.today_pending CASCADE;
DROP TABLE IF EXISTS public.top_prods CASCADE;
DROP TABLE IF EXISTS public.total_customers CASCADE;
DROP TABLE IF EXISTS public.v_global_ltv CASCADE;
DROP TABLE IF EXISTS public.v_global_new_customers_30d CASCADE;
DROP TABLE IF EXISTS public.v_global_orders CASCADE;
DROP TABLE IF EXISTS public.v_global_total_customers CASCADE;
DROP TABLE IF EXISTS public.v_previous_hash CASCADE;
DROP TABLE IF EXISTS public.v_revenue_history CASCADE;
DROP TABLE IF EXISTS public.v_top_products CASCADE;
DROP TABLE IF EXISTS public.vendas CASCADE;
DROP VIEW IF EXISTS public.vw_store_config_public CASCADE;

COMMIT;
