-- 91b-antes-o-preco-do-produto-deixa-historico-ausente: ANTES da 20261386000000 (ou depois do rollback-manual-destrutivo dela). SO LEITURA,
-- somente catalogo, rol fechado de 4 linhas. Nao le nenhuma linha. O rollback-manual COMUM mantem a tabela (e as linhas): depois dele a
-- linha dos objetos novos fica "nao" de proposito e so o destrutivo apaga a tabela.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'produto_historico_preco, registrar_historico_de_preco e tr_produto_historico_de_preco: ainda NAO existem', 'sim', CASE WHEN
    to_regclass('public.produto_historico_preco') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'registrar_historico_de_preco')
    AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.produtos') AND t.tgname = 'tr_produto_historico_de_preco' AND NOT t.tgisinternal) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'produtos: id uuid e preco_venda numeric existem e a tabela tem RLS ligada', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_attribute WHERE attrelid = to_regclass('public.produtos') AND NOT attisdropped AND attnum > 0
        AND ((attname = 'id' AND atttypid = 'uuid'::regtype) OR (attname = 'preco_venda' AND atttypid = 'numeric'::regtype))) = 2
    AND EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.produtos') AND relkind = 'r' AND relrowsecurity) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'rls_admin_atual() existe com o corpo da 20261197000000 (md5) e e executavel pelo authenticated', 'sim', CASE WHEN COALESCE(
    (SELECT md5(replace(p.prosrc, chr(13), '')) = 'ccb7a56e835b8181795fffb7bee97305'
       FROM pg_proc p WHERE p.oid = to_regprocedure('public.rls_admin_atual()')), false)
    AND COALESCE(has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
