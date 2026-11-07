-- 128a-conferir-o-cadastro-cria-o-perfil-em-toda-loja-aplicado: DEPOIS da 20261399930000 (o gatilho on_auth_user_created de auth.users, que cria o perfil no cadastro, existe, esta ligado e e' o desenhado).
-- SO LEITURA, rol fechado de 6 linhas. Nao le nome, telefone, CPF nem e-mail: so catalogo e uma CONTAGEM (a ultima linha conta usuario de cliente sem perfil, sem devolver quem e').
-- ATENCAO: a IKCOUS e a Savy JA TEM o gatilho (a Savy ganhou a mao em 07/11/2026), entao nas duas a 128a sai POSITIVA ANTES do apply; so uma loja futura, clonada do baseline, a teria NEGATIVA
-- antes ("nao" nas linhas do gatilho, nunca erro). Nas duas lojas de hoje o apply e' no-op idempotente que grava o ledger (o portao PARA ate o dono decidir: sem backfillLedger).
-- O gatilho e' comparado pela ESTRUTURA do catalogo (funcao, momento, por linha, sem WHEN, sem lista de colunas), nao pelo texto de pg_get_triggerdef, que muda com o search_path da sessao.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'auth.users: gatilho on_auth_user_created existe, AFTER INSERT por linha, chama public.handle_new_user(), sem condicao nem lista de colunas', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('auth.users') AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal
       AND t.tgfoid = to_regprocedure('public.handle_new_user()')::oid AND t.tgtype = 5 AND t.tgnargs = 0 AND t.tgqual IS NULL AND cardinality(t.tgattr::int2[]) = 0) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'auth.users: o gatilho on_auth_user_created esta LIGADO (nao desabilitado)', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('auth.users') AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'public.handle_new_user() existe, devolve trigger e e SECURITY DEFINER', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.handle_new_user()') AND p.prorettype = 'trigger'::regtype AND p.prosecdef) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'so existe UM gatilho em auth.users que chama handle_new_user: nenhum concorrente', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = to_regclass('auth.users') AND NOT t.tgisinternal
        AND t.tgfoid = to_regprocedure('public.handle_new_user()')::oid) = 1 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'nenhum usuario de cliente (papel customer ou sem papel, nome ate 120 e telefone ate 20) esta sem perfil', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
       AND COALESCE(u.raw_app_meta_data->>'role', 'customer') = 'customer'
       AND char_length(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', 'Usuario')) <= 120
       AND COALESCE(char_length(u.raw_user_meta_data->>'phone'), 0) <= 20) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
