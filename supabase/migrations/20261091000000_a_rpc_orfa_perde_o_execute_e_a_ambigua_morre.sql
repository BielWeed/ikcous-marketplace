-- ============================================================================
-- Migration 20261091000000 — a RPC órfã perde o EXECUTE e a ambígua morre
-- (BANCO-070, issue #114 — frente blindagem-banco-0409, 04/09/2026)
-- ============================================================================
--
-- O PROBLEMA (medido ao vivo em 04/09, scripts/db-inspect-blindagem-114.cjs —
-- o MAPA completo de chamadores x usos internos vem dele): o banco carrega
-- grants de EXECUTE por atacado que ninguém revê. Destaques perigosos:
--
--   * create_marketplace_order_v22 — o checkout JÁ migrou para v23/v24
--     (src/hooks/useOrders.ts escolhe por ternário); a v22 segue com EXECUTE
--     para anon e authenticated. A v22 só ENCAMINHA para a v23 (docs da casa:
--     docs/auditoria/2026-08-20-cliente-e-backend.md — "inofensiva"): o risco
--     dela não é errar, é ser uma porta de escrita de pedido que ninguém
--     precisa ter aberta. (O "pedido zerado" da issue #114 é a v1, que o
--     banco já blindou: EXECUTE só postgres/service_role.) NOTA para o dono:
--     um bundle antigo em cache de service worker ainda pode chamá-la — a
--     revogação é o fechamento por princípio; medir logs antes é opção.
--   * create_marketplace_order_v23 e _v24 — as duas vivas do checkout têm
--     EXECUTE para PUBLIC (grantee vazio no proacl, herdado do grant da
--     criação). PUBLIC não precisa existir: os papéis reais (anon para o
--     checkout de CONVIDADO — a chamada roda com a chave anônima quando não
--     há sessão — e authenticated) já têm grant próprio.
--   * get_sales_analytics tem DUAS sobrecargas que diferem só por
--     timestamp x timestamptz; get_retention_analytics tem DUAS (0 args
--     RETURNS TABLE x p_days DEFAULT 90 RETURNS numeric). Ambíguas para o
--     PostgREST (300 Multiple Choices) — e o código NÃO chama nenhuma delas:
--     o painel usa get_admin_analytics_v2, get_retention_rate e
--     get_category_analytics (src/hooks/useAnalytics.ts).
--
-- O QUE ESTA MIGRATION FAZ (critério de aceite da #114, um bloco cada):
--
--   1. v22 órfã: anon e authenticated perdem EXECUTE (postgres e
--      service_role ficam — a função não é dropada, só sai do alcance do app).
--   2. v23/v24 vivas: PUBLIC perde EXECUTE; anon e authenticated MANTÊM
--      (checkout de convidado e de cliente continuam).
--   3. Sobrecargas ambíguas: morre a irmã exata de cada par —
--      get_sales_analytics(timestamp,timestamp) e
--      get_retention_analytics(p_days integer) — e fica UMA de cada
--      (timestamptz e a versão TABLE, as assinaturas úteis). Antes do DROP o
--      mapa provou: zero call sites no código, zero policies, views, crons,
--      defaults, índices e corpos de função as referenciam. A prova
--      (db-prove-blindagem-rpcs-orfas.cjs) re-verifica essas pré-condições
--      AO VIVO antes de simular o DROP — se algo passou a usá-las, ela aborta.
--   4. As demais RPCs órfãs COMPLETAS do mapa perdem EXECUTE de anon e
--      authenticated (postgres/service_role ficam). A lista é a medida de
--      04/09, não a lista de 30/07 da issue: check_stock_v1 já não existe
--      mais; validate_coupon_secure (v1) é órfã porque o código chama a v2;
--      handle_order_item_stock e tr_prevent_role_change são trigger functions
--      SEM trigger — já estavam fora do alcance do app, o REVOKE nelas é
--      no-op documentado (idempotência).
--
-- FORA DO ESCOPO (registrado no relatório da frente, não mexido):
--   * handle_produto_atualizado() tem trigger VIVO e também carrega PUBLIC —
--     mesmo defeito de nascimento da v23, mas fora do critério desta issue.
--   * DROP das 19 órfãs: não pedido; aposentadoria = fora do alcance do app.
--
-- IDEMPOTÊNCIA: REVOKE de privilégio ausente e DROP de função inexistente são
-- no-ops? NÃO o DROP: re-executar depois de aplicada ERRA (função já dropada,
-- "does not exist"). Por isso o DROP leva IF EXISTS — re-executar mantém o
-- mesmo estado final sem erro.
--
-- COMO PROVAR (padrão da casa — transação com ROLLBACK, nada gravado):
--   node scripts/db-prove-blindagem-rpcs-orfas.cjs
-- A prova simula o DEPOIS dentro da transação (os mesmos REVOKE/DROP + 
-- pré-condições re-verificadas ao vivo) e desfaz tudo; roda TANTO antes da
-- aplicação quanto depois (REVOKE vira no-op e as afirmativas provam o vivo).
--
-- ROLLBACK: rollback-manual-20261091000000_*.sql versionado junto — inclui
-- o CREATE fiel (pg_get_functiondef de 04/09) das duas funções dropadas.
-- ============================================================================

-- 1. v22: o checkout não chama mais; sai do alcance de quem não precisa -----
REVOKE EXECUTE ON FUNCTION public.create_marketplace_order_v22(
  p_items jsonb, p_total_amount numeric, p_shipping_cost numeric,
  p_payment_method text, p_address_id uuid, p_coupon_code text,
  p_customer_name text, p_customer_phone text, p_observation text,
  p_address_data jsonb)
FROM anon, authenticated;

-- 2. v23/v24 (as vivas do checkout): PUBLIC sai, os papéis reais ficam ------
REVOKE EXECUTE ON FUNCTION public.create_marketplace_order_v23(
  p_items jsonb, p_total_amount numeric, p_shipping_cost numeric,
  p_payment_method text, p_address_id uuid, p_coupon_code text,
  p_customer_name text, p_customer_phone text, p_observation text,
  p_address_data jsonb, p_destination_cep text, p_shipping_option_id text,
  p_idempotency_key uuid)
FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.create_marketplace_order_v24(
  p_items jsonb, p_total_amount numeric, p_shipping_cost numeric,
  p_payment_method text, p_address_id uuid, p_coupon_code text,
  p_customer_name text, p_customer_phone text, p_observation text,
  p_address_data jsonb, p_destination_cep text, p_shipping_option_id text,
  p_idempotency_key uuid)
FROM PUBLIC;

-- 3. Sobrecargas ambíguas: a irmã exata morre, fica uma de cada -------------
DROP FUNCTION IF EXISTS public.get_sales_analytics(timestamp without time zone, timestamp without time zone);
DROP FUNCTION IF EXISTS public.get_retention_analytics(integer);

-- 4. Órfãs completas do mapa: fora do alcance do app -------------------------
-- (postgres e service_role ficam; anon/authenticated saem)
REVOKE EXECUTE ON FUNCTION public.check_is_admin() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_user_confirmation_status(p_email text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_stock(p_id uuid, quantity integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_active_products_internal() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_stats() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_summary() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_executive_summary() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_list_paginated(p_table_name text, p_page_size integer, p_page_number integer, p_search_query text, p_filter_status text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_category_sales(start_date text, end_date text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_customer_intelligence() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_inventory_health() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_product_optimization_data() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_product_stats() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_products_with_variants() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_coupon_secure(p_code text, p_subtotal numeric) FROM anon, authenticated;
-- As duas sobreviventes do bloco 3 também são órfãs de chamada: ficam no
-- banco como biblioteca para a tela de analytics que ainda vai nascer, mas
-- fora do alcance do app até alguém precisar de verdade.
REVOKE EXECUTE ON FUNCTION public.get_retention_analytics() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_sales_analytics(start_date timestamp with time zone, end_date timestamp with time zone) FROM anon, authenticated;
-- Trigger functions sem trigger: no MOLDE já estão sem anon/authenticated;
-- o REVOKE nelas é no-op no molde (idempotência) — ATENÇÃO: REVOKE não tem
-- IF EXISTS; numa base onde a função NÃO exista, o statement ERRA e o
-- db-apply (que aplica o arquivo numa transação só) aborta a migration
-- inteira sem aplicar nada — fail-closed deliberado: banco sem a função é
-- banco divergente do molde e deve parar em vermelho, não passar calado.
REVOKE EXECUTE ON FUNCTION public.handle_order_item_stock() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tr_prevent_role_change() FROM anon, authenticated;
