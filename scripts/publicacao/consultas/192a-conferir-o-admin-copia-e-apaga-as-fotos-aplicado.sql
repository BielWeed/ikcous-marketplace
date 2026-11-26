-- 192a-conferir-o-admin-copia-e-apaga-as-fotos-aplicado: DEPOIS da 20261550000000. SO LEITURA, somente catalogo, rol fechado de 4 linhas.
-- Prova POR OBJETO: as duas politicas SELECT que a migration cria em storage.objects ("Admin Select Access (products|banners)"), cada
-- uma SELECT, PERMISSIVE, so para authenticated e com o guarda do admin de agora (rls_admin_atual), sem WITH CHECK. Nenhuma loja tinha
-- politica com esses nomes antes (as antigas usam "Public Display", "Public Read Banners Bucket" e "Leitura publica"), entao esta consulta
-- so fica positiva depois do apply. Nao le nenhum arquivo do bucket. A condicao e' comparada SEM espacos e sem o prefixo public. (o
-- search_path de quem consulta varia), no mesmo formato da 82a.
WITH pol AS (
  SELECT p.polname, p.polcmd, p.polpermissive, p.polroles, p.polwithcheck,
         regexp_replace(replace(pg_get_expr(p.polqual, p.polrelid), 'public.', ''), '[[:space:]]', '', 'g') AS qual
    FROM pg_policy p
   WHERE p.polrelid = to_regclass('storage.objects')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: politicas de storage.objects visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pol) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'Admin Select Access (products): SELECT PERMISSIVE so para authenticated, so no bucket products e so para o admin de agora (rls_admin_atual)', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pol WHERE polname = 'Admin Select Access (products)' AND polcmd = 'r' AND polpermissive
                        AND polroles = ARRAY['authenticated'::regrole::oid] AND polwithcheck IS NULL
                        AND qual = '((bucket_id=''products''::text)AND(SELECTrls_admin_atual()ASrls_admin_atual))') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'Admin Select Access (banners): SELECT PERMISSIVE so para authenticated, so no bucket banners e so para o admin de agora (rls_admin_atual)', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pol WHERE polname = 'Admin Select Access (banners)' AND polcmd = 'r' AND polpermissive
                        AND polroles = ARRAY['authenticated'::regrole::oid] AND polwithcheck IS NULL
                        AND qual = '((bucket_id=''banners''::text)AND(SELECTrls_admin_atual()ASrls_admin_atual))') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'storage.objects: RLS ligada (sem ela as politicas nao valem)', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('storage.objects') AND relrowsecurity) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
