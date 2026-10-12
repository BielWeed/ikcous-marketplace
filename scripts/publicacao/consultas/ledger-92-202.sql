-- Só depois de 8e (todas as linhas ok=true). Mesma forma da 6a/7a. BACKFILL das 9
-- migrations 20261192..20261202 que já estavam aplicadas quando o aplicar-migrations
-- passou a registrar o ledger no próprio apply; a 20261201 (a 93 não existe) NÃO
-- entra: ela sobe fora de hora, no run dela, e é o apply dela que a registra.
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261192000000', 'o_ledger_registra_cada_estorno_do_mp_uma_vez'),
  ('20261194000000', 'ja_estornei_so_em_pedido_pago'),
  ('20261195000000', 'recusado_e_recebido_recusam_nulo'),
  ('20261196000000', 'a_contestacao_decide_sob_a_trava_do_pedido'),
  ('20261197000000', 'dinheiro_exige_admin_atual'),
  ('20261198000000', 'cancelar_pedido_anula_a_cobranca'),
  ('20261199000000', 'portas_do_painel_exigem_admin_atual'),
  ('20261200000000', 'a_decisao_da_devolucao_exige_o_admin_atual'),
  ('20261202000000', 'as_politicas_do_pedido_e_do_financeiro_exigem_o_admin_atual')
ON CONFLICT (version) DO NOTHING;
