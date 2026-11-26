-- 192b-antes-o-admin-copia-e-apaga-as-fotos-ausente: ANTES da 20261550000000 (ou depois do rollback-manual dela). SO LEITURA, somente
-- catalogo, rol fechado de 5 linhas. As linhas 2 e 3 provam que as duas politicas desta migration ainda NAO existem (nem homonima alheia,
-- que o pre-voo recusaria); as linhas 4 e 5 sao a base que o pre-voo exige: rls_admin_atual() com o corpo da 20261197000000 (md5 sem CR),
-- SECURITY DEFINER, EXECUTE de authenticated e nao de anon; storage.objects com RLS ligada. Se vier "nao" na 4 ou na 5 ANTES do apply, o
-- pre-voo recusa (B1_BASELINE_DIVERGENT, nada escrito) - meca antes. Nao le nenhum arquivo do bucket.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: politicas de storage.objects visiveis a este papel', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('storage.objects')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'Admin Select Access (products): ainda NAO existe em storage.objects', 'sim',
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('storage.objects') AND polname = 'Admin Select Access (products)')
         THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'Admin Select Access (banners): ainda NAO existe em storage.objects', 'sim',
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('storage.objects') AND polname = 'Admin Select Access (banners)')
         THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'rls_admin_atual(): corpo da 20261197000000, SECURITY DEFINER, EXECUTE de authenticated e nao de anon (a base do pre-voo)', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = to_regprocedure('public.rls_admin_atual()')
                         AND md5(replace(p.prosrc, chr(13), '')) = 'ccb7a56e835b8181795fffb7bee97305'
                         AND p.prosecdef
                         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'storage.objects: existe com RLS ligada (a base do pre-voo)', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('storage.objects') AND relrowsecurity) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
