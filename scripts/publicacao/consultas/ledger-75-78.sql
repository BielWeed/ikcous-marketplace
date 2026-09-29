INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261175000000', 'a_devolucao_nasce_no_pedido'),
  ('20261176000000', 'o_cartao_online_nasce'),
  ('20261177000000', 'o_financeiro_da_loja_nasce'),
  ('20261178000000', 'o_crm_e_o_inicio_leem_a_loja')
ON CONFLICT (version) DO NOTHING;
