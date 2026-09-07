-- ============================================================================
-- Migration 2026110000200 — a loja clonada nasce com os mesmos grants
-- (frente grants-da-loja-clonada, 08/09/2026 — brief da mesa
-- equipe/entregas/20260908-brief-migration-convergencia-de-grants-loja-clonada.md)
-- ============================================================================
--
-- O PROBLEMA (medido em 08/09/2026 ~00:50, `pg_proc.proacl` +
-- `has_function_privilege` nos DOIS bancos): a loja da Savy (clone
-- `projects/cliente-01`) tem o MESMO ledger de migrations que o principal
-- (78/78 até `20261073000000`), mas nasceu com os privilégios de EXECUTE bem
-- mais frouxos: **71 das 86 funções de `public` deixam PUBLIC executar (o
-- `anon` alcança 71), contra 11 (anon 20) no principal.** Comparando função a
-- função, em **58 funções** a Savy tem grant a mais que o principal, em
-- **136 combinações função×papel** — e em NENHUM caso é o oposto (o
-- principal nunca tem um grant que a Savy não tenha).
--
-- Causa provável: o principal foi endurecido por migrations hoje ARQUIVADAS
-- (`supabase/migrations/_arquivadas/*hardening*`, `*final_rpc_permissions*`)
-- que nunca rodaram no clone; o baseline `20260806000000_baseline_do_schema_
-- vivo.sql` não carrega esses REVOKEs. É o defeito da ADR 0002 ("o banco não
-- nasce do zero") com outro nome: toda loja clonada a partir do baseline
-- nasce com o ACL frouxo, não com o ACL endurecido que o principal tem hoje.
--
-- Consequência concreta já observada: a prova PRÉ da `20261091000000`
-- (`scripts/db-prove-blindagem-rpcs-orfas.cjs`) FALHA na Savy em "blindagem
-- 114: anon ainda alcanca EXECUTE de check_is_admin" — porque o `=X` de
-- PUBLIC sobrevive ao `REVOKE ... FROM anon, authenticated` daquela migration
-- (RE VOKE de um papel não tira o que PUBLIC concede a todo mundo).
--
-- A CURA — o que esta migration FAZ: só `REVOKE EXECUTE`, um statement por
-- função, agrupando os papéis que diferem (PUBLIC, anon, authenticated
-- conforme o caso — nunca service_role nem postgres). As 58 funções e os
-- papéis exatos vêm da comparação função a função entre os dois bancos; a
-- lista abaixo é essa comparação, não um recorte por nome.
--
-- O QUE NÃO MUDA:
--   * secdef, dono, corpo e demais grants (service_role, postgres) de
--     qualquer função — idêntico nos dois bancos, medido, e esta migration
--     não toca neles.
--   * As 2 funções que só existem na Savy hoje — `get_retention_analytics
--     (integer)` e `get_sales_analytics(timestamp without time zone,
--     timestamp without time zone)` — NÃO entram aqui: são exatamente as
--     duas sobrecargas ambíguas que a migration `20261091000000` (que roda
--     ANTES desta no ledger) já DROPa. Nada de `IF EXISTS` inventado: se
--     alguma das 58 funções abaixo não existir num banco, o REVOKE falha e a
--     transação inteira desfaz — é o comportamento desejado (banco divergiu
--     do molde, tem que parar em vermelho).
--   * `solicitar_estorno`/`concluir_estorno` (T1/T3 do estorno) — existem só
--     no principal hoje (migrations `2026110000000`/`2026110000100`, ainda
--     não aplicadas na Savy) e não entram nesta comparação.
--
-- NO PRINCIPAL, ESTA MIGRATION É NO-OP: todos os REVOKEs abaixo já valem lá
-- (é de lá que vem o alvo). Ela existe para que TODA loja clonada a partir
-- do baseline convirja para o mesmo ACL de funções que o principal tem hoje
-- — Savy é a primeira, não a única.
--
-- IDEMPOTÊNCIA: `REVOKE EXECUTE ... FROM <papel>` de um privilégio que o
-- papel já não tem é NO-OP no Postgres (aviso, não erro) — reexecutar este
-- arquivo depois de aplicado, ou aplicá-lo num banco onde já vale (o
-- principal), não erra e não muda nada.
--
-- COMO APLICAR: só via `node scripts/db-apply.cjs` (uma transação por
-- arquivo, com registro no ledger) ou `psql -1` — NUNCA `supabase db push`,
-- NUNCA statement a statement (uma falha no meio deixaria o pacote pela
-- metade).
--
-- COMO PROVAR (padrão da casa — transação com ROLLBACK, nada gravado):
--   ANTES de aplicar:   node scripts/db-prove-grants-convergem.cjs
--      (lê ESTE arquivo do disco — sha256 impresso — e o executa numa tx
--      desfeita no fim; roda o rollback na mesma tx e prova que o ACL volta
--      à fotografia de entrada)
--   DEPOIS de aplicar:  node scripts/db-prove-grants-convergem.cjs --verificar
--      (NÃO simula nada: mede o estado VIVO, fora de transação)
--   Rodar ANTES nos DOIS bancos (Savy via o lançador que lê o `.env` do
--   clone; principal via o `.env` do repo) — no principal a prova tem de
--   mostrar ZERO mudança de ACL (no-op) e passar do mesmo jeito.
--
-- ROLLBACK: `rollback-manual-2026110000200_*.sql` versionado junto — devolve
-- exatamente os GRANTs que a Savy tinha medido antes desta migration. NÃO
-- FAZ SENTIDO no principal (ver cabeçalho do rollback).
--
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK do script de prova
-- vira no-op e a mudança fica gravada).
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.answer_question_atomic(uuid,text,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.answer_question_atomic(uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_is_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clean_expired_shipping_quotes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clean_old_shipping_logs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_marketplace_order_v22(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrement_stock(uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_role_protection() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_order_otp_v1(text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_active_products_internal() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_v2(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_customers_paged(text,text,text,integer,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_summary() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_executive_summary() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_list_paginated(text,integer,integer,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_products_paged(text,text,text,text,integer,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_questions_paged(text,text,integer,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_reviews_paged(text,text,integer,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_user_detail(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_category_analytics(timestamp with time zone,timestamp with time zone) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_category_sales(text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_coupon_stats() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_customer_intelligence() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_inventory_health() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_complete_profile() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_orders_by_whatsapp_v3(text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_product_optimization_data() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_product_recommendations(uuid,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_product_stats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_products_with_variants() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_retention_analytics() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_retention_rate() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_reviews_metrics(text,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sales_analytics(timestamp with time zone,timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_segmented_push_targets(text,numeric,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_default_address() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_order_item_stock() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_profile_role_sync_to_auth() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_public_profile_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_helpful(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_role_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_vor_action(text,jsonb,jsonb,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reply_review_atomic(uuid,text,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reply_review_atomic(uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.swap_banner_order(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_cart_atomic(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tr_prevent_role_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_my_profile_secure(text,text,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_order_status_atomic(uuid,text,text,boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.validate_coupon_secure_v2(text,numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_coupon_secure(text,numeric) FROM PUBLIC, anon, authenticated;
