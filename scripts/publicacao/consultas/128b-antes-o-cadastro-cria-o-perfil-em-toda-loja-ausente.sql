-- 128b-antes-o-cadastro-cria-o-perfil-em-toda-loja-ausente: ANTES da 20261399930000 (ou depois do rollback-manual dela). SO LEITURA, somente catalogo,
-- rol fechado de 3 linhas. Nao le nenhum usuario nem perfil. Numa loja SEM o gatilho tudo "sim"; depois do apply (ou onde o gatilho ja existe) a linha do gatilho fica "nao" de proposito.
-- ATENCAO: a IKCOUS e a Savy JA TEM o gatilho (a Savy ganhou a mao em 07/11/2026), entao nas duas a 128b sai NEGATIVA (a migration e' no-op la); so uma loja futura, clonada do baseline, a teria POSITIVA.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'auth.users tem id, raw_user_meta_data e raw_app_meta_data; profiles tem id, full_name, whatsapp, cpf e role; handle_new_user() existe (trigger, SECURITY DEFINER)', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = to_regclass('auth.users') AND NOT a.attisdropped
        AND ((a.attname = 'id' AND a.atttypid = 'uuid'::regtype) OR (a.attname = 'raw_user_meta_data' AND a.atttypid = 'jsonb'::regtype)
             OR (a.attname = 'raw_app_meta_data' AND a.atttypid = 'jsonb'::regtype))) = 3
    AND (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.profiles') AND NOT a.attisdropped
        AND a.attname IN ('id', 'full_name', 'whatsapp', 'cpf', 'role')) = 5
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.handle_new_user()') AND p.prorettype = 'trigger'::regtype AND p.prosecdef) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'nenhum gatilho on_auth_user_created existe ainda em auth.users', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('auth.users') AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
