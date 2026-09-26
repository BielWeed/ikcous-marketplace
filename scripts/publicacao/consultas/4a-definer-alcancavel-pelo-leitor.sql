-- Funções SECURITY DEFINER em public que o papel supabase_read_only_user
-- consegue EXECUTAR — se aparecer alguma linha, é uma porta de escrita
-- alcançável pelo caminho só-leitura (achado #3 da revisão de risco,
-- rodada 3: o papel não ter grant de escrita numa tabela não impede uma
-- função SECURITY DEFINER concedida a PUBLIC de escrever por dentro dela).
-- Esperado: 0 linhas. to_regrole(...) devolve NULL (em vez de erro) se o
-- papel não existir neste projeto — a consulta roda igual, mas fica muda:
-- "0 linhas" aqui NÃO prova nada se o papel não existir de verdade.
SELECT p.proname
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.prosecdef
   AND has_function_privilege(to_regrole('supabase_read_only_user'), p.oid, 'EXECUTE')
 ORDER BY p.proname;
