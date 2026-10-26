-- 99b-antes-ninguem-grava-evento-de-analise-base-vigente: ANTES da 20261391100000 (ou depois do rollback-manual dela).
-- SO LEITURA, somente catalogo, rol fechado de 4 linhas. Prova a politica EXATA da 20261112000000, o INSERT do
-- authenticated (o que a migration tira) e que nenhuma funcao de public grava na tabela (premissa da revogacao).
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
  UNION ALL SELECT 'analytics_events_insert_policy: a da 20261112000000 (INSERT so authenticated, auth.uid() = user_id) e nenhuma outra de INSERT/ALL', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pol WHERE polname = 'analytics_events_insert_policy' AND polcmd = 'a' AND polpermissive
                        AND polroles = ARRAY['authenticated'::regrole::oid] AND polqual IS NULL
                        AND chk = '((SELECTauth.uid()ASuid)=user_id)')
          AND NOT EXISTS (SELECT 1 FROM pol WHERE polcmd IN ('a', '*') AND polname <> 'analytics_events_insert_policy') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'analytics_events: authenticated com INSERT, anon sem, e nenhuma funcao de public grava na tabela', 'sim',
    CASE WHEN (SELECT tab.oid FROM tab) IS NOT NULL
          AND has_table_privilege('authenticated', 'public.analytics_events', 'INSERT')
          AND NOT has_table_privilege('anon', 'public.analytics_events', 'INSERT')
          AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                            AND p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+(public[.])?"?analytics_events') THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
