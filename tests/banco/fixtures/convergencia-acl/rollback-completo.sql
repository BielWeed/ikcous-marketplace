BEGIN;
-- Desfaz SO a convergencia. Volta ao estado medido depois da emergencia de 16:28:45Z
-- (confirmar_pagamento e devolver_uso_cupom continuam fechadas). Grants de coluna e service_role nao mudam no pacote.
CREATE TEMP TABLE _rb_fn (fn regprocedure, pub boolean, anon boolean, auth boolean) ON COMMIT DROP;
INSERT INTO _rb_fn VALUES
('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', false, true, true),
('public.admin_devolucao_decidir(uuid,boolean,text,timestamp with time zone)', false, true, true),
('public.admin_devolucao_liberar_vinculo_reverso(uuid,boolean)', false, true, true),
('public.admin_devolucao_reemitir_reembolso(uuid,boolean)', false, true, true),
('public.admin_devolucao_registrar(uuid,text,text,text)', false, true, true),
('public.admin_devolucao_reprovar(uuid,text)', false, true, true),
('public.admin_devolucoes_listar(text,text,integer,integer)', false, true, true),
('public.answer_question_atomic(uuid,text,uuid)', false, true, true),
('public.answer_question_atomic(uuid,text)', false, true, true),
('public.assinatura_da_loja_ler()', false, true, true),
('public.branding_a5_track_revision()', false, true, true),
('public.buscar_por_codigo_barras(text)', false, true, true),
('public.cancelar_devolucao(uuid)', false, true, true),
('public.check_is_admin()', false, true, true),
('public.check_user_confirmation_status(text)', false, true, true),
('public.clean_expired_shipping_quotes()', false, true, true),
('public.clean_old_shipping_logs()', false, true, true),
('public.concluir_estorno(uuid,text,text,text)', false, true, true),
('public.confirmar_retorno_do_produto(uuid)', false, true, true),
('public.create_marketplace_order_v22(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb)', false, true, true),
('public.create_marketplace_order(jsonb,text,uuid,text,text,text,text)', false, true, true),
('public.crm__clientes_rfm(timestamp with time zone)', false, true, true),
('public.crm__nunca_comprou(timestamp with time zone)', false, true, true),
('public.crm__pedidos_nao_pagos(timestamp with time zone)', false, true, true),
('public.crm__vendas(timestamp with time zone)', false, true, true),
('public.crm_clientes(text,text,integer,integer)', false, true, true),
('public.crm_visao(date,date)', false, true, true),
('public.decrement_stock(uuid,integer)', false, true, true),
('public.devolucao__entregue_em(uuid)', false, true, true),
('public.devolucao__hoje()', false, true, true),
('public.devolucao__metodos(text,text,boolean,text[],text[])', false, true, true),
('public.devolucao__modalidade(text,text)', false, true, true),
('public.devolucao__registrar_evento(uuid,text,text,text,text)', false, true, true),
('public.devolucao_avisa_o_cliente()', false, true, true),
('public.devolucao_detalhe(uuid)', false, true, true),
('public.devolucao_elegibilidade(uuid)', false, true, true),
('public.devolucoes_do_pedido(uuid)', false, true, true),
('public.devolver_cupons_de_pedidos_mortos()', false, true, true),
('public.devolver_estoque(uuid)', false, true, true),
('public.dominio_publico_so_muda_pela_frota()', false, true, true),
('public.ensure_role_protection()', false, true, true),
('public.expirar_pedidos_vencidos()', false, true, true),
('public.fin__caixa_calculo(uuid)', false, true, true),
('public.fin__conta_da_forma(text)', false, true, true),
('public.fin__dia(timestamp with time zone)', false, true, true),
('public.fin__forma_do_pedido(text,text)', false, true, true),
('public.fin__hoje()', false, true, true),
('public.fin__movimentos(date,date)', false, true, true),
('public.fin__saldos()', false, true, true),
('public.fin_caixa_abrir(numeric,uuid)', false, true, true),
('public.fin_caixa_atual()', false, true, true),
('public.fin_caixa_fechar(numeric,text)', false, true, true),
('public.fin_caixa_historico(integer)', false, true, true),
('public.fin_caixa_movimentar(text,numeric,text,uuid)', false, true, true),
('public.fin_categoria_salvar(jsonb)', false, true, true),
('public.fin_categorias_listar()', false, true, true),
('public.fin_conta_salvar(jsonb)', false, true, true),
('public.fin_contas_listar()', false, true, true),
('public.fin_dre(date,date)', false, true, true),
('public.fin_extrato(date,date,uuid)', false, true, true),
('public.fin_lancamento_baixar(uuid,date,uuid)', false, true, true),
('public.fin_lancamento_cancelar(uuid,text)', false, true, true),
('public.fin_lancamento_salvar(jsonb)', false, true, true),
('public.fin_previstos(text)', false, true, true),
('public.fin_resumo(date,date)', false, true, true),
('public.generate_order_otp_v1(text,text,text)', false, true, true),
('public.generate_order_otp_v2(text,text,text)', false, true, true),
('public.get_active_products_internal()', false, true, true),
('public.get_admin_analytics_v2(integer)', false, true, true),
('public.get_admin_customers_paged(text,text,text,integer,integer)', false, true, true),
('public.get_admin_dashboard_stats()', false, true, true),
('public.get_admin_dashboard_summary()', false, true, true),
('public.get_admin_executive_summary()', false, true, true),
('public.get_admin_list_paginated(text,integer,integer,text,text)', false, true, true),
('public.get_admin_orders_cancelados_recentes(integer,integer,integer)', false, true, true),
('public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)', false, true, true),
('public.get_admin_products_paged(text,text,text,text,integer,integer)', false, true, true),
('public.get_admin_questions_paged(text,text,integer,integer)', false, true, true),
('public.get_admin_reviews_paged(text,text,integer,integer)', false, true, true),
('public.get_admin_user_detail(uuid)', false, true, true),
('public.get_category_analytics(timestamp with time zone,timestamp with time zone)', false, true, true),
('public.get_category_sales(text,text)', false, true, true),
('public.get_coupon_stats()', false, true, true),
('public.get_customer_intelligence()', false, true, true),
('public.get_inventory_health()', false, true, true),
('public.get_my_complete_profile()', false, true, true),
('public.get_my_cpf()', false, true, true),
('public.get_orders_by_whatsapp_v3(text,text,text)', false, true, true),
('public.get_product_optimization_data()', false, true, true),
('public.get_product_stats()', false, true, true),
('public.get_products_with_variants()', false, true, true),
('public.get_retention_analytics()', false, true, true),
('public.get_retention_rate()', false, true, true),
('public.get_sales_analytics(timestamp with time zone,timestamp with time zone)', false, true, true),
('public.get_segmented_push_targets(text,numeric,integer)', false, true, true),
('public.handle_default_address()', false, true, true),
('public.handle_new_user()', false, true, true),
('public.handle_order_item_stock()', false, true, true),
('public.handle_profile_role_sync_to_auth()', false, true, true),
('public.handle_public_profile_sync()', false, true, true),
('public.handle_updated_at()', false, true, true),
('public.informar_envio_devolucao(uuid,text)', false, true, true),
('public.liberar_cobranca_do_pedido(uuid,text)', false, true, true),
('public.liberar_email_de_confirmacao(uuid)', false, true, true),
('public.marca_estorno_direto_do_pedido()', false, true, true),
('public.pagamentos_a_reconciliar()', false, true, true),
('public.painel_inicio()', false, true, true),
('public.prevent_role_change()', false, true, true),
('public.read_store_identity()', false, true, true),
('public.record_vor_action(text,jsonb,jsonb,text)', false, true, true),
('public.registrar_estorno_manual(uuid)', false, true, true),
('public.registrar_pagamento_recebido(uuid,boolean)', false, true, true),
('public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)', false, true, true),
('public.reivindicar_email_de_confirmacao(uuid)', false, true, true),
('public.reorder_banners_atomic(text,uuid,uuid)', false, true, true),
('public.reply_review_atomic(uuid,text,uuid)', false, true, true),
('public.reply_review_atomic(uuid,text)', false, true, true),
('public.resolver_loja(text,text)', false, true, true),
('public.salvar_config_pagamento_cartao(boolean,boolean,integer)', false, true, true),
('public.salvar_politica_de_devolucao(jsonb)', false, true, true),
('public.save_store_identity(text,jsonb,jsonb)', false, true, true),
('public.set_my_cpf(text)', false, true, true),
('public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])', false, true, true),
('public.solicitar_estorno(uuid,numeric,text)', false, true, true),
('public.store_config_exige_forma_de_pagamento()', false, true, true),
('public.swap_banner_order(uuid,uuid)', false, true, true),
('public.sync_cart_atomic(jsonb)', false, true, true),
('public.tr_prevent_role_change()', false, true, true),
('public.update_my_profile_secure(text,text,text,text)', false, true, true),
('public.update_order_status_atomic(uuid,text,text,boolean)', false, true, true),
('public.upsert_store_config(jsonb)', false, true, true),
('public.validate_coupon_secure(text,numeric)', false, true, true);
CREATE TEMP TABLE _rb_sr_antes ON COMMIT DROP AS
SELECT p.oid, has_function_privilege('service_role', p.oid, 'EXECUTE') AS pode
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public';
CREATE TEMP TABLE _rb_esperado (fn regprocedure, acl text) ON COMMIT DROP;
DO $$
DECLARE
  f record;
  sr boolean;
  alvo text;
  lista text[];
BEGIN
  FOR f IN SELECT * FROM _rb_fn LOOP
    IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = f.fn) <> 'postgres' THEN
      RAISE EXCEPTION 'desfazer: % tem dono diferente de postgres', f.fn; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f.fn AND x.grantee <> 0
                  AND pg_get_userbyid(x.grantee) NOT IN ('postgres', 'anon', 'authenticated', 'service_role')) THEN
      RAISE EXCEPTION 'desfazer: % tem grantee fora do conhecido', f.fn; END IF;
    sr := EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f.fn AND x.grantee = 'service_role'::regrole AND x.privilege_type = 'EXECUTE');
    alvo := f.fn::text;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, postgres, anon, authenticated, service_role', alvo);
    lista := '{}';
    IF f.pub THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', alvo); lista := lista || '=X/postgres'; END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO postgres', alvo); lista := lista || 'postgres=X/postgres';
    IF f.anon THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', alvo); lista := lista || 'anon=X/postgres'; END IF;
    IF f.auth THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', alvo); lista := lista || 'authenticated=X/postgres'; END IF;
    IF sr THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', alvo); lista := lista || 'service_role=X/postgres'; END IF;
    INSERT INTO _rb_esperado VALUES (f.fn, '{' || array_to_string(lista, ',') || '}');
  END LOOP;
END $$;
GRANT ALL ON public.analytics_events TO anon, authenticated;
GRANT ALL ON public.answers_dedup_backup_20260812 TO anon, authenticated;
GRANT ALL ON public.assinatura_da_loja TO anon, authenticated;
GRANT ALL ON public.config_pagamento_cartao TO anon, authenticated;
GRANT ALL ON public.devolucao_eventos TO anon, authenticated;
GRANT ALL ON public.devolucao_itens TO anon, authenticated;
GRANT ALL ON public.devolucoes TO anon, authenticated;
GRANT ALL ON public.fin_caixa_sessoes TO anon, authenticated;
GRANT ALL ON public.fin_categorias TO anon, authenticated;
GRANT ALL ON public.fin_contas TO anon, authenticated;
GRANT ALL ON public.fin_lancamentos TO anon, authenticated;
GRANT ALL ON public.frota_lojas TO anon, authenticated;
GRANT ALL ON public.frota_segredo TO anon, authenticated;
GRANT ALL ON public.marketplace_orders TO anon, authenticated;
GRANT ALL ON public.order_refunds TO anon, authenticated;
GRANT ALL ON public.politica_devolucao TO anon, authenticated;
GRANT ALL ON public.produtos TO anon, authenticated;
GRANT ALL ON public.vw_produtos_admin TO anon, authenticated;
GRANT ALL ON public.vw_produtos_public TO anon, authenticated;
GRANT ALL ON public.vw_questions_public TO anon, authenticated;
GRANT ALL ON public.vw_reviews_public TO anon, authenticated;
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: admin_devolucao_concluir(uuid,text,jsonb,numeric,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: admin_devolucao_concluir(uuid,text,jsonb,numeric,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.admin_devolucao_decidir(uuid,boolean,text,timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: admin_devolucao_decidir(uuid,boolean,text,timestamp with time zone) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.admin_devolucao_decidir(uuid,boolean,text,timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: admin_devolucao_decidir(uuid,boolean,text,timestamp with time zone) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.admin_devolucao_liberar_vinculo_reverso(uuid,boolean)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: admin_devolucao_liberar_vinculo_reverso(uuid,boolean) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.admin_devolucao_liberar_vinculo_reverso(uuid,boolean)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: admin_devolucao_liberar_vinculo_reverso(uuid,boolean) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.admin_devolucao_reemitir_reembolso(uuid,boolean)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: admin_devolucao_reemitir_reembolso(uuid,boolean) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.admin_devolucao_reemitir_reembolso(uuid,boolean)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: admin_devolucao_reemitir_reembolso(uuid,boolean) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.admin_devolucao_registrar(uuid,text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: admin_devolucao_registrar(uuid,text,text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.admin_devolucao_registrar(uuid,text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: admin_devolucao_registrar(uuid,text,text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.admin_devolucao_reprovar(uuid,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: admin_devolucao_reprovar(uuid,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.admin_devolucao_reprovar(uuid,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: admin_devolucao_reprovar(uuid,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.admin_devolucoes_listar(text,text,integer,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: admin_devolucoes_listar(text,text,integer,integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.admin_devolucoes_listar(text,text,integer,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: admin_devolucoes_listar(text,text,integer,integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.answer_question_atomic(uuid,text,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: answer_question_atomic(uuid,text,uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.answer_question_atomic(uuid,text,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: answer_question_atomic(uuid,text,uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.answer_question_atomic(uuid,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: answer_question_atomic(uuid,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.answer_question_atomic(uuid,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: answer_question_atomic(uuid,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.assinatura_da_loja_ler()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: assinatura_da_loja_ler() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.assinatura_da_loja_ler()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: assinatura_da_loja_ler() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.branding_a2_assets_valid(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: branding_a2_assets_valid(jsonb) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.branding_a2_assets_valid(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: branding_a2_assets_valid(jsonb) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.branding_a2_file_valid(jsonb,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: branding_a2_file_valid(jsonb,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.branding_a2_file_valid(jsonb,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: branding_a2_file_valid(jsonb,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.branding_a2_logo_valid(jsonb,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: branding_a2_logo_valid(jsonb,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.branding_a2_logo_valid(jsonb,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: branding_a2_logo_valid(jsonb,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.branding_a5_track_revision()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: branding_a5_track_revision() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.branding_a5_track_revision()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: branding_a5_track_revision() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.buscar_por_codigo_barras(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: buscar_por_codigo_barras(text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.buscar_por_codigo_barras(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: buscar_por_codigo_barras(text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.cancelar_devolucao(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: cancelar_devolucao(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.cancelar_devolucao(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: cancelar_devolucao(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.check_is_admin()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: check_is_admin() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.check_is_admin()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: check_is_admin() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.check_user_confirmation_status(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: check_user_confirmation_status(text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.check_user_confirmation_status(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: check_user_confirmation_status(text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.clean_expired_shipping_quotes()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: clean_expired_shipping_quotes() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.clean_expired_shipping_quotes()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: clean_expired_shipping_quotes() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.clean_old_shipping_logs()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: clean_old_shipping_logs() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.clean_old_shipping_logs()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: clean_old_shipping_logs() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.concluir_estorno(uuid,text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: concluir_estorno(uuid,text,text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.concluir_estorno(uuid,text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: concluir_estorno(uuid,text,text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.confirmar_pagamento(uuid,text,text)', 'EXECUTE') IS DISTINCT FROM false THEN RAISE EXCEPTION 'desfazer: confirmar_pagamento(uuid,text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.confirmar_pagamento(uuid,text,text)', 'EXECUTE') IS DISTINCT FROM false THEN RAISE EXCEPTION 'desfazer: confirmar_pagamento(uuid,text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.confirmar_retorno_do_produto(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: confirmar_retorno_do_produto(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.confirmar_retorno_do_produto(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: confirmar_retorno_do_produto(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.create_marketplace_order_v22(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: create_marketplace_order_v22(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.create_marketplace_order_v22(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: create_marketplace_order_v22(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.create_marketplace_order(jsonb,text,uuid,text,text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: create_marketplace_order(jsonb,text,uuid,text,text,text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.create_marketplace_order(jsonb,text,uuid,text,text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: create_marketplace_order(jsonb,text,uuid,text,text,text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.crm__clientes_rfm(timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: crm__clientes_rfm(timestamp with time zone) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.crm__clientes_rfm(timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: crm__clientes_rfm(timestamp with time zone) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.crm__nunca_comprou(timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: crm__nunca_comprou(timestamp with time zone) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.crm__nunca_comprou(timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: crm__nunca_comprou(timestamp with time zone) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.crm__pedidos_nao_pagos(timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: crm__pedidos_nao_pagos(timestamp with time zone) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.crm__pedidos_nao_pagos(timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: crm__pedidos_nao_pagos(timestamp with time zone) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.crm__vendas(timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: crm__vendas(timestamp with time zone) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.crm__vendas(timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: crm__vendas(timestamp with time zone) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.crm_clientes(text,text,integer,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: crm_clientes(text,text,integer,integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.crm_clientes(text,text,integer,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: crm_clientes(text,text,integer,integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.crm_visao(date,date)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: crm_visao(date,date) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.crm_visao(date,date)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: crm_visao(date,date) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.decrement_stock(uuid,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: decrement_stock(uuid,integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.decrement_stock(uuid,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: decrement_stock(uuid,integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.devolucao__entregue_em(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao__entregue_em(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.devolucao__entregue_em(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao__entregue_em(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.devolucao__hoje()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao__hoje() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.devolucao__hoje()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao__hoje() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.devolucao__metodos(text,text,boolean,text[],text[])', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao__metodos(text,text,boolean,text[],text[]) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.devolucao__metodos(text,text,boolean,text[],text[])', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao__metodos(text,text,boolean,text[],text[]) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.devolucao__modalidade(text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao__modalidade(text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.devolucao__modalidade(text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao__modalidade(text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.devolucao__registrar_evento(uuid,text,text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao__registrar_evento(uuid,text,text,text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.devolucao__registrar_evento(uuid,text,text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao__registrar_evento(uuid,text,text,text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.devolucao_avisa_o_cliente()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao_avisa_o_cliente() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.devolucao_avisa_o_cliente()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao_avisa_o_cliente() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.devolucao_detalhe(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao_detalhe(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.devolucao_detalhe(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao_detalhe(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.devolucao_elegibilidade(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao_elegibilidade(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.devolucao_elegibilidade(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucao_elegibilidade(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.devolucoes_do_pedido(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucoes_do_pedido(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.devolucoes_do_pedido(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolucoes_do_pedido(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.devolver_cupons_de_pedidos_mortos()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolver_cupons_de_pedidos_mortos() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.devolver_cupons_de_pedidos_mortos()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolver_cupons_de_pedidos_mortos() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.devolver_estoque(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolver_estoque(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.devolver_estoque(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: devolver_estoque(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.devolver_uso_cupom(uuid)', 'EXECUTE') IS DISTINCT FROM false THEN RAISE EXCEPTION 'desfazer: devolver_uso_cupom(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.devolver_uso_cupom(uuid)', 'EXECUTE') IS DISTINCT FROM false THEN RAISE EXCEPTION 'desfazer: devolver_uso_cupom(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.dominio_publico_so_muda_pela_frota()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: dominio_publico_so_muda_pela_frota() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.dominio_publico_so_muda_pela_frota()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: dominio_publico_so_muda_pela_frota() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.ensure_role_protection()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: ensure_role_protection() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.ensure_role_protection()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: ensure_role_protection() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.expirar_pedidos_vencidos()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: expirar_pedidos_vencidos() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.expirar_pedidos_vencidos()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: expirar_pedidos_vencidos() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.f_digitos(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: f_digitos(text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.f_digitos(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: f_digitos(text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.f_unaccent(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: f_unaccent(text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.f_unaccent(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: f_unaccent(text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin__caixa_calculo(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin__caixa_calculo(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin__caixa_calculo(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin__caixa_calculo(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin__conta_da_forma(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin__conta_da_forma(text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin__conta_da_forma(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin__conta_da_forma(text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin__dia(timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin__dia(timestamp with time zone) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin__dia(timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin__dia(timestamp with time zone) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin__forma_do_pedido(text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin__forma_do_pedido(text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin__forma_do_pedido(text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin__forma_do_pedido(text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin__hoje()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin__hoje() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin__hoje()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin__hoje() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin__movimentos(date,date)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin__movimentos(date,date) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin__movimentos(date,date)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin__movimentos(date,date) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin__saldos()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin__saldos() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin__saldos()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin__saldos() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_caixa_abrir(numeric,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_caixa_abrir(numeric,uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_caixa_abrir(numeric,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_caixa_abrir(numeric,uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_caixa_atual()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_caixa_atual() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_caixa_atual()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_caixa_atual() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_caixa_fechar(numeric,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_caixa_fechar(numeric,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_caixa_fechar(numeric,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_caixa_fechar(numeric,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_caixa_historico(integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_caixa_historico(integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_caixa_historico(integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_caixa_historico(integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_caixa_movimentar(text,numeric,text,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_caixa_movimentar(text,numeric,text,uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_caixa_movimentar(text,numeric,text,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_caixa_movimentar(text,numeric,text,uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_categoria_salvar(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_categoria_salvar(jsonb) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_categoria_salvar(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_categoria_salvar(jsonb) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_categorias_listar()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_categorias_listar() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_categorias_listar()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_categorias_listar() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_conta_salvar(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_conta_salvar(jsonb) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_conta_salvar(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_conta_salvar(jsonb) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_contas_listar()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_contas_listar() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_contas_listar()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_contas_listar() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_dre(date,date)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_dre(date,date) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_dre(date,date)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_dre(date,date) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_extrato(date,date,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_extrato(date,date,uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_extrato(date,date,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_extrato(date,date,uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_lancamento_baixar(uuid,date,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_lancamento_baixar(uuid,date,uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_lancamento_baixar(uuid,date,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_lancamento_baixar(uuid,date,uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_lancamento_cancelar(uuid,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_lancamento_cancelar(uuid,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_lancamento_cancelar(uuid,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_lancamento_cancelar(uuid,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_lancamento_salvar(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_lancamento_salvar(jsonb) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_lancamento_salvar(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_lancamento_salvar(jsonb) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_previstos(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_previstos(text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_previstos(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_previstos(text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.fin_resumo(date,date)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_resumo(date,date) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.fin_resumo(date,date)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: fin_resumo(date,date) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.forma_de_pagamento_aceita(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: forma_de_pagamento_aceita(text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.forma_de_pagamento_aceita(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: forma_de_pagamento_aceita(text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.formas_pagamento_sem_duplicata(text[])', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: formas_pagamento_sem_duplicata(text[]) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.formas_pagamento_sem_duplicata(text[])', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: formas_pagamento_sem_duplicata(text[]) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.generate_order_otp_v1(text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: generate_order_otp_v1(text,text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.generate_order_otp_v1(text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: generate_order_otp_v1(text,text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.generate_order_otp_v2(text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: generate_order_otp_v2(text,text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.generate_order_otp_v2(text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: generate_order_otp_v2(text,text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_active_products_internal()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_active_products_internal() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_active_products_internal()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_active_products_internal() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_admin_analytics_v2(integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_analytics_v2(integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_admin_analytics_v2(integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_analytics_v2(integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_admin_customers_paged(text,text,text,integer,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_customers_paged(text,text,text,integer,integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_admin_customers_paged(text,text,text,integer,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_customers_paged(text,text,text,integer,integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_admin_dashboard_stats()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_dashboard_stats() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_admin_dashboard_stats()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_dashboard_stats() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_admin_dashboard_summary()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_dashboard_summary() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_admin_dashboard_summary()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_dashboard_summary() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_admin_executive_summary()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_executive_summary() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_admin_executive_summary()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_executive_summary() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_admin_list_paginated(text,integer,integer,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_list_paginated(text,integer,integer,text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_admin_list_paginated(text,integer,integer,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_list_paginated(text,integer,integer,text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_admin_orders_cancelados_recentes(integer,integer,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_orders_cancelados_recentes(integer,integer,integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_admin_orders_cancelados_recentes(integer,integer,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_orders_cancelados_recentes(integer,integer,integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_orders_paged(text,text,text,text,integer,integer,text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_orders_paged(text,text,text,text,integer,integer,text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_admin_products_paged(text,text,text,text,integer,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_products_paged(text,text,text,text,integer,integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_admin_products_paged(text,text,text,text,integer,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_products_paged(text,text,text,text,integer,integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_admin_questions_paged(text,text,integer,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_questions_paged(text,text,integer,integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_admin_questions_paged(text,text,integer,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_questions_paged(text,text,integer,integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_admin_reviews_paged(text,text,integer,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_reviews_paged(text,text,integer,integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_admin_reviews_paged(text,text,integer,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_reviews_paged(text,text,integer,integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_admin_user_detail(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_user_detail(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_admin_user_detail(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_admin_user_detail(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_category_analytics(timestamp with time zone,timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_category_analytics(timestamp with time zone,timestamp with time zone) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_category_analytics(timestamp with time zone,timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_category_analytics(timestamp with time zone,timestamp with time zone) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_category_sales(text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_category_sales(text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_category_sales(text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_category_sales(text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_coupon_stats()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_coupon_stats() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_coupon_stats()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_coupon_stats() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_customer_intelligence()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_customer_intelligence() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_customer_intelligence()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_customer_intelligence() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_inventory_health()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_inventory_health() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_inventory_health()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_inventory_health() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_my_complete_profile()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_my_complete_profile() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_my_complete_profile()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_my_complete_profile() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_my_cpf()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_my_cpf() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_my_cpf()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_my_cpf() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_orders_by_otp_v1(text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_orders_by_otp_v1(text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_orders_by_otp_v1(text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_orders_by_otp_v1(text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_orders_by_whatsapp_v3(text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_orders_by_whatsapp_v3(text,text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_orders_by_whatsapp_v3(text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_orders_by_whatsapp_v3(text,text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_product_optimization_data()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_product_optimization_data() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_product_optimization_data()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_product_optimization_data() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_product_recommendations(uuid,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_product_recommendations(uuid,integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_product_recommendations(uuid,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_product_recommendations(uuid,integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_product_stats()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_product_stats() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_product_stats()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_product_stats() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_products_with_variants()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_products_with_variants() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_products_with_variants()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_products_with_variants() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_retention_analytics()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_retention_analytics() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_retention_analytics()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_retention_analytics() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_retention_rate()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_retention_rate() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_retention_rate()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_retention_rate() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_reviews_metrics(text,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_reviews_metrics(text,integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_reviews_metrics(text,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_reviews_metrics(text,integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_sales_analytics(timestamp with time zone,timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_sales_analytics(timestamp with time zone,timestamp with time zone) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_sales_analytics(timestamp with time zone,timestamp with time zone)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_sales_analytics(timestamp with time zone,timestamp with time zone) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_segmented_push_count(text,numeric,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_segmented_push_count(text,numeric,integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_segmented_push_count(text,numeric,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_segmented_push_count(text,numeric,integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.get_segmented_push_targets(text,numeric,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_segmented_push_targets(text,numeric,integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.get_segmented_push_targets(text,numeric,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: get_segmented_push_targets(text,numeric,integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.handle_default_address()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_default_address() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.handle_default_address()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_default_address() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_new_user() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_new_user() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.handle_order_item_stock()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_order_item_stock() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.handle_order_item_stock()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_order_item_stock() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.handle_produto_atualizado()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_produto_atualizado() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.handle_produto_atualizado()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_produto_atualizado() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.handle_profile_role_sync_to_auth()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_profile_role_sync_to_auth() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.handle_profile_role_sync_to_auth()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_profile_role_sync_to_auth() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.handle_public_profile_sync()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_public_profile_sync() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.handle_public_profile_sync()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_public_profile_sync() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.handle_updated_at()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_updated_at() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.handle_updated_at()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_updated_at() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.handle_variant_atualiza_produto()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_variant_atualiza_produto() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.handle_variant_atualiza_produto()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: handle_variant_atualiza_produto() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.increment_helpful(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: increment_helpful(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.increment_helpful(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: increment_helpful(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.informar_envio_devolucao(uuid,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: informar_envio_devolucao(uuid,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.informar_envio_devolucao(uuid,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: informar_envio_devolucao(uuid,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.is_admin()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: is_admin() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: is_admin() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.is_local_cep(text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: is_local_cep(text,text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.is_local_cep(text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: is_local_cep(text,text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.liberar_cobranca_do_pedido(uuid,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: liberar_cobranca_do_pedido(uuid,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.liberar_cobranca_do_pedido(uuid,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: liberar_cobranca_do_pedido(uuid,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.liberar_email_de_confirmacao(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: liberar_email_de_confirmacao(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.liberar_email_de_confirmacao(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: liberar_email_de_confirmacao(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.limpar_cotacoes_fora_da_janela()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: limpar_cotacoes_fora_da_janela() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.limpar_cotacoes_fora_da_janela()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: limpar_cotacoes_fora_da_janela() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.marca_avaliacao_nasce_verificada()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: marca_avaliacao_nasce_verificada() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.marca_avaliacao_nasce_verificada()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: marca_avaliacao_nasce_verificada() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.marca_avaliacoes_do_pedido_verificadas()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: marca_avaliacoes_do_pedido_verificadas() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.marca_avaliacoes_do_pedido_verificadas()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: marca_avaliacoes_do_pedido_verificadas() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.marca_estorno_direto_do_pedido()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: marca_estorno_direto_do_pedido() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.marca_estorno_direto_do_pedido()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: marca_estorno_direto_do_pedido() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.notifica_cliente_de_mudanca_de_pagamento()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: notifica_cliente_de_mudanca_de_pagamento() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.notifica_cliente_de_mudanca_de_pagamento()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: notifica_cliente_de_mudanca_de_pagamento() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.notifica_cliente_de_mudanca_de_status()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: notifica_cliente_de_mudanca_de_status() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.notifica_cliente_de_mudanca_de_status()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: notifica_cliente_de_mudanca_de_status() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.pagamentos_a_reconciliar()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: pagamentos_a_reconciliar() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.pagamentos_a_reconciliar()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: pagamentos_a_reconciliar() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.painel_inicio()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: painel_inicio() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.painel_inicio()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: painel_inicio() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.perfil_publico_avaliacoes(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: perfil_publico_avaliacoes(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.perfil_publico_avaliacoes(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: perfil_publico_avaliacoes(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.perfil_publico_perguntas(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: perfil_publico_perguntas(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.perfil_publico_perguntas(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: perfil_publico_perguntas(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.prevent_role_change()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: prevent_role_change() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.prevent_role_change()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: prevent_role_change() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.read_store_identity()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: read_store_identity() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.read_store_identity()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: read_store_identity() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.record_vor_action(text,jsonb,jsonb,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: record_vor_action(text,jsonb,jsonb,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.record_vor_action(text,jsonb,jsonb,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: record_vor_action(text,jsonb,jsonb,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.registrar_estorno_manual(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: registrar_estorno_manual(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.registrar_estorno_manual(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: registrar_estorno_manual(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.registrar_pagamento_recebido(uuid,boolean)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: registrar_pagamento_recebido(uuid,boolean) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.registrar_pagamento_recebido(uuid,boolean)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: registrar_pagamento_recebido(uuid,boolean) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.reivindicar_email_de_confirmacao(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: reivindicar_email_de_confirmacao(uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.reivindicar_email_de_confirmacao(uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: reivindicar_email_de_confirmacao(uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.reorder_banners_atomic(text,uuid,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: reorder_banners_atomic(text,uuid,uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.reorder_banners_atomic(text,uuid,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: reorder_banners_atomic(text,uuid,uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.reply_review_atomic(uuid,text,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: reply_review_atomic(uuid,text,uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.reply_review_atomic(uuid,text,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: reply_review_atomic(uuid,text,uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.reply_review_atomic(uuid,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: reply_review_atomic(uuid,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.reply_review_atomic(uuid,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: reply_review_atomic(uuid,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.resolver_loja(text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: resolver_loja(text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.resolver_loja(text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: resolver_loja(text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.salvar_config_pagamento_cartao(boolean,boolean,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: salvar_config_pagamento_cartao(boolean,boolean,integer) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.salvar_config_pagamento_cartao(boolean,boolean,integer)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: salvar_config_pagamento_cartao(boolean,boolean,integer) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.salvar_politica_de_devolucao(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: salvar_politica_de_devolucao(jsonb) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.salvar_politica_de_devolucao(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: salvar_politica_de_devolucao(jsonb) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.save_store_identity(text,jsonb,jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: save_store_identity(text,jsonb,jsonb) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.save_store_identity(text,jsonb,jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: save_store_identity(text,jsonb,jsonb) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.set_my_cpf(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: set_my_cpf(text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.set_my_cpf(text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: set_my_cpf(text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: solicitar_devolucao(uuid,jsonb,text,text,text,text,text[]) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: solicitar_devolucao(uuid,jsonb,text,text,text,text,text[]) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.solicitar_estorno(uuid,numeric,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: solicitar_estorno(uuid,numeric,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.solicitar_estorno(uuid,numeric,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: solicitar_estorno(uuid,numeric,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.store_config_exige_forma_de_pagamento()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: store_config_exige_forma_de_pagamento() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.store_config_exige_forma_de_pagamento()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: store_config_exige_forma_de_pagamento() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.swap_banner_order(uuid,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: swap_banner_order(uuid,uuid) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.swap_banner_order(uuid,uuid)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: swap_banner_order(uuid,uuid) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.sync_cart_atomic(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: sync_cart_atomic(jsonb) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.sync_cart_atomic(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: sync_cart_atomic(jsonb) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.tr_prevent_role_change()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: tr_prevent_role_change() / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.tr_prevent_role_change()', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: tr_prevent_role_change() / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.update_my_profile_secure(text,text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: update_my_profile_secure(text,text,text,text) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.update_my_profile_secure(text,text,text,text)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: update_my_profile_secure(text,text,text,text) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.update_order_status_atomic(uuid,text,text,boolean)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: update_order_status_atomic(uuid,text,text,boolean) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.update_order_status_atomic(uuid,text,text,boolean)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: update_order_status_atomic(uuid,text,text,boolean) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.upsert_store_config(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: upsert_store_config(jsonb) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.upsert_store_config(jsonb)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: upsert_store_config(jsonb) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.validate_coupon_secure_v2(text,numeric)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: validate_coupon_secure_v2(text,numeric) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.validate_coupon_secure_v2(text,numeric)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: validate_coupon_secure_v2(text,numeric) / authenticated'; END IF;
  IF has_function_privilege('anon', 'public.validate_coupon_secure(text,numeric)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: validate_coupon_secure(text,numeric) / anon'; END IF;
  IF has_function_privilege('authenticated', 'public.validate_coupon_secure(text,numeric)', 'EXECUTE') IS DISTINCT FROM true THEN RAISE EXCEPTION 'desfazer: validate_coupon_secure(text,numeric) / authenticated'; END IF;
  IF NOT has_table_privilege('anon', 'public._ninja_migrations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public._ninja_migrations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela _ninja_migrations'; END IF;
  IF NOT has_table_privilege('anon', 'public._retrato_business_hours_20261029', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public._retrato_business_hours_20261029', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela _retrato_business_hours_20261029'; END IF;
  IF NOT has_table_privilege('anon', 'public._retrato_primary_color_20260980', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public._retrato_primary_color_20260980', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela _retrato_primary_color_20260980'; END IF;
  IF NOT has_table_privilege('anon', 'public.analytics_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.analytics_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela analytics_events'; END IF;
  IF NOT has_table_privilege('anon', 'public.answers', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.answers', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela answers'; END IF;
  IF NOT has_table_privilege('anon', 'public.answers_dedup_backup_20260812', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.answers_dedup_backup_20260812', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela answers_dedup_backup_20260812'; END IF;
  IF NOT has_table_privilege('anon', 'public.app_settings', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.app_settings', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela app_settings'; END IF;
  IF NOT has_table_privilege('anon', 'public.assinatura_da_loja', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.assinatura_da_loja', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela assinatura_da_loja'; END IF;
  IF NOT has_table_privilege('anon', 'public.banners', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.banners', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela banners'; END IF;
  IF NOT has_table_privilege('anon', 'public.cart_items', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.cart_items', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela cart_items'; END IF;
  IF NOT has_table_privilege('anon', 'public.categorias', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.categorias', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela categorias'; END IF;
  IF NOT has_table_privilege('anon', 'public.config_pagamento_cartao', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.config_pagamento_cartao', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela config_pagamento_cartao'; END IF;
  IF NOT has_table_privilege('anon', 'public.coupons', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.coupons', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela coupons'; END IF;
  IF NOT has_table_privilege('anon', 'public.devolucao_eventos', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.devolucao_eventos', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela devolucao_eventos'; END IF;
  IF NOT has_table_privilege('anon', 'public.devolucao_itens', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.devolucao_itens', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela devolucao_itens'; END IF;
  IF NOT has_table_privilege('anon', 'public.devolucoes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.devolucoes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela devolucoes'; END IF;
  IF NOT has_table_privilege('anon', 'public.favorites', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.favorites', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela favorites'; END IF;
  IF NOT has_table_privilege('anon', 'public.fin_caixa_sessoes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.fin_caixa_sessoes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela fin_caixa_sessoes'; END IF;
  IF NOT has_table_privilege('anon', 'public.fin_categorias', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.fin_categorias', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela fin_categorias'; END IF;
  IF NOT has_table_privilege('anon', 'public.fin_contas', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.fin_contas', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela fin_contas'; END IF;
  IF NOT has_table_privilege('anon', 'public.fin_lancamentos', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.fin_lancamentos', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela fin_lancamentos'; END IF;
  IF NOT has_table_privilege('anon', 'public.frota_lojas', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.frota_lojas', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela frota_lojas'; END IF;
  IF NOT has_table_privilege('anon', 'public.frota_segredo', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.frota_segredo', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela frota_segredo'; END IF;
  IF NOT has_table_privilege('anon', 'public.marketplace_ai_state', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.marketplace_ai_state', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela marketplace_ai_state'; END IF;
  IF NOT has_table_privilege('anon', 'public.marketplace_order_history', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.marketplace_order_history', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela marketplace_order_history'; END IF;
  IF NOT has_table_privilege('anon', 'public.marketplace_order_items', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.marketplace_order_items', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela marketplace_order_items'; END IF;
  IF NOT has_table_privilege('anon', 'public.marketplace_order_payment_history', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.marketplace_order_payment_history', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela marketplace_order_payment_history'; END IF;
  IF NOT has_table_privilege('anon', 'public.marketplace_orders', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.marketplace_orders', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela marketplace_orders'; END IF;
  IF NOT has_table_privilege('anon', 'public.notificacoes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.notificacoes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela notificacoes'; END IF;
  IF NOT has_table_privilege('anon', 'public.order_refunds', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.order_refunds', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela order_refunds'; END IF;
  IF NOT has_table_privilege('anon', 'public.order_shipping_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.order_shipping_events', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela order_shipping_events'; END IF;
  IF NOT has_table_privilege('anon', 'public.otp_verifications', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.otp_verifications', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela otp_verifications'; END IF;
  IF NOT has_table_privilege('anon', 'public.politica_devolucao', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.politica_devolucao', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela politica_devolucao'; END IF;
  IF NOT has_table_privilege('anon', 'public.product_variants', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.product_variants', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela product_variants'; END IF;
  IF NOT has_table_privilege('anon', 'public.produtos', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.produtos', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela produtos'; END IF;
  IF NOT has_table_privilege('anon', 'public.profiles', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.profiles', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela profiles'; END IF;
  IF NOT has_table_privilege('anon', 'public.public_profiles', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.public_profiles', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela public_profiles'; END IF;
  IF NOT has_table_privilege('anon', 'public.push_notifications_log', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.push_notifications_log', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela push_notifications_log'; END IF;
  IF NOT has_table_privilege('anon', 'public.push_subscriptions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela push_subscriptions'; END IF;
  IF NOT has_table_privilege('anon', 'public.questions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.questions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela questions'; END IF;
  IF NOT has_table_privilege('anon', 'public.review_votes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.review_votes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela review_votes'; END IF;
  IF NOT has_table_privilege('anon', 'public.reviews', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.reviews', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela reviews'; END IF;
  IF NOT has_table_privilege('anon', 'public.sales_overview', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.sales_overview', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela sales_overview'; END IF;
  IF NOT has_table_privilege('anon', 'public.shipping_calculation_logs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.shipping_calculation_logs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela shipping_calculation_logs'; END IF;
  IF NOT has_table_privilege('anon', 'public.shipping_quotes_cache', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.shipping_quotes_cache', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela shipping_quotes_cache'; END IF;
  IF NOT has_table_privilege('anon', 'public.store_config', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.store_config', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela store_config'; END IF;
  IF NOT has_table_privilege('anon', 'public.store_shipping_credentials', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.store_shipping_credentials', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela store_shipping_credentials'; END IF;
  IF NOT has_table_privilege('anon', 'public.user_addresses', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.user_addresses', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela user_addresses'; END IF;
  IF NOT has_table_privilege('anon', 'public.v_store_config', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.v_store_config', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela v_store_config'; END IF;
  IF NOT has_table_privilege('anon', 'public.vor_receipts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.vor_receipts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela vor_receipts'; END IF;
  IF NOT has_table_privilege('anon', 'public.vw_produtos_admin', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.vw_produtos_admin', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela vw_produtos_admin'; END IF;
  IF NOT has_table_privilege('anon', 'public.vw_produtos_public', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.vw_produtos_public', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela vw_produtos_public'; END IF;
  IF NOT has_table_privilege('anon', 'public.vw_questions_public', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.vw_questions_public', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela vw_questions_public'; END IF;
  IF NOT has_table_privilege('anon', 'public.vw_questions_with_answers_count', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.vw_questions_with_answers_count', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela vw_questions_with_answers_count'; END IF;
  IF NOT has_table_privilege('anon', 'public.vw_reviews_public', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR NOT has_table_privilege('authenticated', 'public.vw_reviews_public', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'desfazer: tabela vw_reviews_public'; END IF;
  IF EXISTS (SELECT 1 FROM _rb_esperado e JOIN pg_proc p ON p.oid = e.fn WHERE p.proacl::text IS DISTINCT FROM e.acl) THEN
    RAISE EXCEPTION 'desfazer: proacl fora da ordem medida em %', (SELECT string_agg(e.fn::text, ', ') FROM _rb_esperado e JOIN pg_proc p ON p.oid = e.fn WHERE p.proacl::text IS DISTINCT FROM e.acl); END IF;
  IF (SELECT count(*) FROM _rb_esperado) <> 132 THEN RAISE EXCEPTION 'desfazer: esperava 132 funcoes reconstruidas'; END IF;
  IF EXISTS (SELECT 1 FROM _rb_sr_antes s WHERE has_function_privilege('service_role', s.oid, 'EXECUTE') IS DISTINCT FROM s.pode) THEN
    RAISE EXCEPTION 'desfazer: service_role mudou'; END IF;
  IF (SELECT count(DISTINCT (c.relname, a.attname)) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND a.attacl IS NOT NULL AND a.attnum > 0) <> 37 THEN RAISE EXCEPTION 'desfazer: grants de coluna'; END IF;
END $$;
COMMIT;
