-- ============================================================================
-- Rollback manual — chaves de frete só no servidor (20261407000000)
-- ============================================================================
-- Restaura o GRANT ALL padrão de anon e authenticated na tabela. Não toca dados,
-- RLS nem privilégios de service_role. Volta a permitir o acesso direto pela
-- API conforme as políticas RLS da tabela.
--
-- Só usar se a 163b confirmou o estado padrão antes da migration. Confira a
-- 163a antes de reverter e a 163b depois. Se a ACL inicial era diferente, este
-- arquivo não a reproduz.
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma
-- transação). Sem BEGIN/COMMIT de nível superior — regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

GRANT ALL ON TABLE public.store_shipping_credentials TO anon, authenticated;
