-- Só depois de 7a (todas as linhas ok=true). Mesma forma da 6a/1c/2c.
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261183000000', 'o_crm_ve_todo_mundo')
ON CONFLICT (version) DO NOTHING;
