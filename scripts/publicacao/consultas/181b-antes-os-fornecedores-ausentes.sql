-- 181b-antes-os-fornecedores-ausentes: ANTES da 20261450000000 (ou depois do rollback-manual-destrutivo dela). SO LEITURA, somente
-- catalogo, rol fechado de 5 linhas. Nao le nenhuma linha. O rollback-manual COMUM mantem a tabela (selada, com as linhas): depois dele
-- a linha da tabela fica "nao" de proposito e so o destrutivo a apaga. As linhas 4 e 5 sao o que o pre-voo da migration exige do
-- banco (a porta rls_admin_atual() das politicas e o gen_random_uuid() do id): se uma vier "nao", o apply recusaria com B1_BASELINE_DIVERGENT e nada seria escrito, entao a loja nao esta na base de antes.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fornecedores_carimba_atualizado_em: ainda NAO existe', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fornecedores_carimba_atualizado_em') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fornecedores: a tabela ainda NAO existe', 'sim', CASE WHEN to_regclass('public.fornecedores') IS NULL THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a porta rls_admin_atual() existe com o corpo da 20261197000000 (md5), executavel pelo authenticated e nao pelo anon', 'sim', CASE WHEN COALESCE(
    (SELECT md5(replace(p.prosrc, chr(13), '')) = 'ccb7a56e835b8181795fffb7bee97305' AND p.prosecdef
       FROM pg_proc p WHERE p.oid = to_regprocedure('public.rls_admin_atual()')), false)
    AND COALESCE(has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false)
    AND NOT COALESCE(has_function_privilege('anon', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'gen_random_uuid() existe (default do id; PostgreSQL 13 ou mais novo)', 'sim', CASE WHEN to_regprocedure('gen_random_uuid()') IS NOT NULL THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
