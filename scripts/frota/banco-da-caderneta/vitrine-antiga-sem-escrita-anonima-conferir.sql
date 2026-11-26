-- vitrine-antiga-sem-escrita-anonima-conferir: DEPOIS de vitrine-antiga-sem-escrita-anonima.sql, no banco da caderneta (projeto
-- antigo dekxabvqdsuukijblazl). SO LEITURA, somente catalogo, rol fechado de 5 linhas; nao le nenhuma linha de produto. Todas as
-- linhas com ok = true = aplicado. Rodada ANTES, a linha da ACL mostra no "vivo" a ACL medida em 26/11 (ok = false so nela e
-- na de escrita): e' o retrato de antes. Depois do rollback, o mesmo retrato.
WITH v AS (
  SELECT c.oid, c.relkind, c.relacl::text AS acl, pg_get_userbyid(c.relowner) AS dono
  FROM pg_class c WHERE c.oid = to_regclass('public.vw_produtos_public')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'vw_produtos_public existe, e view e e do postgres', 'sim', CASE WHEN
    (SELECT count(*) FROM v) = 1 AND (SELECT relkind FROM v) = 'v' AND (SELECT dono FROM v) = 'postgres' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'vw_produtos_public: ACL exata (texto) igual a das lojas',
    '{postgres=arwdDxtm/postgres,anon=rx/postgres,authenticated=rx/postgres,service_role=arwdDxtm/postgres}',
    COALESCE((SELECT acl FROM v), '(sem ACL ou sem view)')
  UNION ALL SELECT 'anon e authenticated sem INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER e MAINTAIN (tabela) e sem INSERT e UPDATE (coluna)', 'sim', CASE WHEN
    (SELECT count(*) FROM v) = 1
    AND NOT has_table_privilege('anon', (SELECT oid FROM v), 'INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN')
    AND NOT has_table_privilege('authenticated', (SELECT oid FROM v), 'INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN')
    AND NOT has_any_column_privilege('anon', (SELECT oid FROM v), 'INSERT, UPDATE')
    AND NOT has_any_column_privilege('authenticated', (SELECT oid FROM v), 'INSERT, UPDATE') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'anon e authenticated continuam lendo (SELECT), e nenhum privilegio de coluna na view', 'sim', CASE WHEN
    (SELECT count(*) FROM v) = 1
    AND has_table_privilege('anon', (SELECT oid FROM v), 'SELECT')
    AND has_table_privilege('authenticated', (SELECT oid FROM v), 'SELECT')
    AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = (SELECT oid FROM v) AND a.attacl IS NOT NULL) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
