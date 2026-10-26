-- 99a-conferir-ninguem-grava-evento-de-analise-aplicado: DEPOIS da 20261391100000. SO LEITURA, somente catalogo, rol
-- fechado de 4 linhas. Nao le nenhum evento. Antes do apply responde "nao" nas linhas da migration, nunca erro.
WITH tab AS (
  SELECT to_regclass('public.analytics_events') AS oid
), pol AS (
  SELECT p.polname, p.polcmd, p.polpermissive, p.polroles, p.polqual,
         regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '[[:space:]]', '', 'g') AS chk
    FROM pg_policy p, tab WHERE p.polrelid = tab.oid
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'analytics_events: tabela com RLS ligada e a leitura do admin (analytics_events_select_policy) no lugar', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_class c, tab WHERE c.oid = tab.oid AND c.relkind = 'r' AND c.relrowsecurity)
          AND EXISTS (SELECT 1 FROM pol WHERE polname = 'analytics_events_select_policy' AND polcmd = 'r') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'analytics_events: nenhuma politica de INSERT/ALL', 'sim',
    CASE WHEN (SELECT tab.oid FROM tab) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pol WHERE polcmd IN ('a', '*')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'analytics_events: anon e authenticated sem INSERT (tabela e coluna), service_role com INSERT', 'sim',
    CASE WHEN (SELECT tab.oid FROM tab) IS NOT NULL
          AND NOT has_table_privilege('authenticated', 'public.analytics_events', 'INSERT')
          AND NOT has_any_column_privilege('authenticated', 'public.analytics_events', 'INSERT')
          AND NOT has_table_privilege('anon', 'public.analytics_events', 'INSERT')
          AND NOT has_any_column_privilege('anon', 'public.analytics_events', 'INSERT')
          AND has_table_privilege('service_role', 'public.analytics_events', 'INSERT') THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
