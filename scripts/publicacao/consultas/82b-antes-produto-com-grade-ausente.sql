-- ANTES da 20261352000000 (ou depois do rollback dela); SO LEITURA, somente catalogo, rol fechado de 4 linhas. Exige a base pronta e a funcao nova AUSENTE.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'salvar_produto_com_grade: ainda NAO existe', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'salvar_produto_com_grade') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'is_admin() e is_admin_atual() existem (a funcao nova as chama)', 'sim', CASE WHEN
    to_regprocedure('public.is_admin()') IS NOT NULL AND to_regprocedure('public.is_admin_atual()') IS NOT NULL THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'gatilhos de versao: set_ultima_atualizacao em produtos e sync_produto_ultima_atualizacao em variacoes ligados', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) = 2 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled <> 'D'
        AND ((t.tgrelid = to_regclass('public.produtos') AND t.tgname = 'set_ultima_atualizacao')
          OR (t.tgrelid = to_regclass('public.product_variants') AND t.tgname = 'sync_produto_ultima_atualizacao'))), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
