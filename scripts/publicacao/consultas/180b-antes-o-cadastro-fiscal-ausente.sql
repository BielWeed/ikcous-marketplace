-- 180b-antes-o-cadastro-fiscal-ausente: ANTES da 20261440000000 (ou depois do rollback-manual-destrutivo dela). SO LEITURA, somente catalogo,
-- rol fechado de 6 linhas. Nao le nenhuma linha. O rollback-manual COMUM mantem as duas tabelas (e as linhas): depois dele a linha das tabelas
-- fica "nao" de proposito e so o destrutivo as apaga. As linhas 4 a 6 sao o que o pre-voo da migration exige do banco: se uma
-- vier "nao", o apply recusaria com B1_BASELINE_DIVERGENT e nada seria escrito, entao a loja nao esta na base de antes.
-- NAO confere o fin_dre: a funcao nova nao o le e a migration nao o confere nem o redefine (nenhuma base anterior a exige).
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fiscal_cadastro_salvar: ainda NAO existe', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fiscal_cadastro_salvar') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'fiscal_cadastro e fiscal_cadastro_log: ainda NAO existem', 'sim', CASE WHEN to_regclass('public.fiscal_cadastro') IS NULL AND to_regclass('public.fiscal_cadastro_log') IS NULL THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'as portas do admin atual existem com o corpo da 20261197000000 (md5), rls_admin_atual() executavel pelo authenticated e nao pelo anon', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) = 2 AND bool_and(CASE p.proname WHEN 'is_admin_atual' THEN md5(replace(p.prosrc, chr(13), '')) = '519842163e48cc377ac1337ffb9db936'
                                    ELSE md5(replace(p.prosrc, chr(13), '')) = 'ccb7a56e835b8181795fffb7bee97305' END AND p.prosecdef)
       FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.is_admin_atual()'), to_regprocedure('public.rls_admin_atual()'))), false)
    AND COALESCE(has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false)
    AND NOT COALESCE(has_function_privilege('anon', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'dono_da_loja existe com a forma da 20261383000000 (loja boolean, user_id uuid, desde timestamptz, tudo NOT NULL) e RLS ligada', 'sim', CASE WHEN
    EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.dono_da_loja') AND relkind = 'r' AND relrowsecurity)
    AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
           FROM pg_attribute a WHERE a.attrelid = to_regclass('public.dono_da_loja') AND a.attnum > 0 AND NOT a.attisdropped)
        = 'loja:boolean:true,user_id:uuid:true,desde:timestamp with time zone:true' THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a politica fin_lancamentos_admin_select_policy existe como a 20261202000000 a deixa (SELECT, so authenticated, rls_admin_atual())', 'sim', CASE WHEN
    EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass('public.fin_lancamentos') AND p.polname = 'fin_lancamentos_admin_select_policy'
              AND p.polcmd = 'r' AND p.polpermissive AND p.polwithcheck IS NULL
              AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]::oid[]
              AND replace(pg_get_expr(p.polqual, p.polrelid), 'public.', '') = '( SELECT rls_admin_atual() AS rls_admin_atual)') THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
