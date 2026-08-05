-- Rollback MANUAL de 20260805000000_restore_admin_view_and_hide_custo.sql
-- (BANCO-010, #119)
--
-- POR QUE ESTE ARQUIVO FOI ESCRITO À MÃO
--   O db-apply.cjs gera rollback automático lendo pg_get_functiondef das funções
--   que a migration redefine — `funcoesAlteradas()` casa apenas
--   `CREATE OR REPLACE FUNCTION`. Esta migration não toca função nenhuma: ela
--   cria uma VIEW e troca GRANTs. O rollback automático dela sai vazio, e um
--   arquivo vazio dá a impressão perigosa de que existe volta.
--
-- ESTADO PARA O QUAL ISTO VOLTA, medido em 05/08/2026 antes de aplicar:
--   - vw_produtos_admin NÃO existia em nenhum schema
--   - authenticated tinha SELECT de TABELA em public.produtos
--   Ou seja: voltar por aqui REABRE o vazamento da #119 de propósito, e
--   quebra de novo o cadastro de produto. Só use se a migration causar dano
--   maior que os dois.
--
-- COMO RODAR: cole inteiro no SQL Editor do Supabase, ou
--   psql "$DATABASE_URL" -f rollback-20260805000000_restore_admin_view_and_hide_custo.sql

BEGIN;

DROP VIEW IF EXISTS public.vw_produtos_admin;

-- Devolve o SELECT de tabela e limpa os grants por coluna.
--
-- Os dois passos, e nesta ordem, porque eu NÃO tenho certeza se revogar o
-- privilégio de tabela no PostgreSQL derruba junto os privilégios por coluna —
-- e chutar semântica de permissão foi exatamente como este projeto se machucou
-- na #115. Revogar coluna a coluna primeiro e conceder a tabela depois chega no
-- mesmo estado nas duas interpretações.
DO $$
DECLARE
    v_colunas text;
BEGIN
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO v_colunas
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'produtos';

    IF v_colunas IS NULL THEN
        RAISE EXCEPTION 'Nao consegui montar a lista de colunas de produtos.';
    END IF;

    EXECUTE format('REVOKE SELECT (%s) ON public.produtos FROM authenticated', v_colunas);
END $$;

GRANT SELECT ON public.produtos TO authenticated;

COMMIT;

-- Confira depois de rodar: o resultado tem de ser SELECT para authenticated,
-- sem lista de colunas, e nenhuma linha para a view.
--
--   SELECT grantee, privilege_type FROM information_schema.table_privileges
--    WHERE table_schema='public' AND table_name='produtos' AND grantee='authenticated';
--
--   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='public' AND c.relname='vw_produtos_admin';
