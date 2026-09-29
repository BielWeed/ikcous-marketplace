-- Só depois de 2a (12 marcadores ok) e 2b (tudo ok). Mesma forma da 1c.
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261172000000', 'o_cpf_do_destinatario_mora_no_pedido'),
  ('20261173000000', 'o_cpf_mora_na_conta'),
  ('20261174000000', 'formas_de_pagamento_por_loja')
ON CONFLICT (version) DO NOTHING;
