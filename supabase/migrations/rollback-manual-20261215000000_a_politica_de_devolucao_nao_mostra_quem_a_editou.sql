-- Rollback manual da 20261215000000_a_politica_de_devolucao_nao_mostra_quem_a_editou.sql
-- Devolve o estado anterior: SELECT da TABELA INTEIRA para anon e authenticated
-- (reabre o achado L: `updated_by`, o uuid do admin que salvou por último,
-- volta a ser legível sem login). Sem BEGIN/COMMIT (regra da casa); quem abre
-- a transação é o aplicador. Idempotente.
--
-- O REVOKE de tabela tira também os privilégios por coluna que a migration
-- concedeu; só então vem o GRANT da tabela inteira, que é o estado da
-- 20261175000000.

REVOKE SELECT ON public.politica_devolucao FROM anon, authenticated;
GRANT SELECT ON public.politica_devolucao TO anon, authenticated;
