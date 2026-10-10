-- Só depois de 6a (todas as linhas ok=true). Mesma forma da 1c/2c.
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261179000000', 'cancelar_devolucao_barra_compra_em_voo'),
  ('20261180000000', 'cliente_nao_cancela_com_cartao_vivo'),
  ('20261181000000', 'pedido_por_whatsapp_fecha_para_anon'),
  ('20261182000000', 'o_cpf_da_janela_sai_do_endereco')
ON CONFLICT (version) DO NOTHING;
