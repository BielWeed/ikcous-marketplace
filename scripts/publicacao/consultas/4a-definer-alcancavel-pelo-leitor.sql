-- Funções SECURITY DEFINER, em QUALQUER schema (menos pg_catalog e
-- information_schema — sistema do próprio Postgres), que o papel
-- supabase_read_only_user consegue EXECUTAR. Se aparecer alguma linha, é
-- uma porta de escrita alcançável pelo caminho só-leitura: o papel não ter
-- grant de escrita numa tabela não impede uma função SECURITY DEFINER
-- concedida a PUBLIC de escrever por dentro dela — e isso vale em QUALQUER
-- schema, não só `public` (achado #3 da revisão de risco, rodada 3, ampliado
-- na rodada 4: uma definer em outro schema também escreve).
-- Esperado: 0 linhas. Se vier a linha
-- "(supabase_read_only_user AUSENTE — resultado não vale)" em vez disso, o
-- papel não existe neste projeto e "0 linhas" NÃO PROVA nada — rode de novo
-- com o papel certo antes de confiar no resultado.
SELECT pronamespace::regnamespace || '.' || proname AS funcao
  FROM pg_proc
 WHERE pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
   AND prosecdef
   AND has_function_privilege(to_regrole('supabase_read_only_user'), oid, 'EXECUTE')
UNION ALL
SELECT '(supabase_read_only_user AUSENTE — resultado não vale)' AS funcao
 WHERE to_regrole('supabase_read_only_user') IS NULL
 ORDER BY 1;
