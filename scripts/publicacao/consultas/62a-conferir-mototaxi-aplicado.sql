-- Somente catalogo. Rol fechado: 6 linhas; nunca retorna o contato.
WITH tabela AS (
  SELECT c.oid, c.relrowsecurity, c.relkind FROM pg_class c
    WHERE c.oid = to_regclass('public.config_mototaxi')
), fn AS (
  SELECT p.*, l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = to_regprocedure('public.salvar_config_mototaxi(text,text)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'config_mototaxi: colunas e restricoes', 'sim', CASE WHEN
    (SELECT string_agg(a.attname || ':' || a.atttypid::regtype::text || ':' || a.attnotnull, ',' ORDER BY a.attnum)
       FROM pg_attribute a WHERE a.attrelid = to_regclass('public.config_mototaxi') AND a.attnum > 0 AND NOT a.attisdropped) = 'id:integer:true,whatsapp:text:false,nome:text:false'
    AND (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.config_mototaxi') AND convalidated) = 4
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.config_mototaxi') AND contype = 'p' AND conkey = ARRAY[1]::smallint[])
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.config_mototaxi') AND conname = 'config_mototaxi_id_check' AND pg_get_constraintdef(oid) = 'CHECK ((id = 1))')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.config_mototaxi') AND conname = 'config_mototaxi_whatsapp_check' AND pg_get_constraintdef(oid) = 'CHECK (((whatsapp IS NULL) OR (whatsapp ~ ''^55(1[1-9]|2[12478]|3[1-578]|4[1-9]|5[13-5]|6[1-9]|7[134579]|8[1-9]|9[1-9])([2-5][0-9]{7}|9[0-9]{8})$''::text)))')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.config_mototaxi') AND conname = 'config_mototaxi_nome_check' AND pg_get_constraintdef(oid) = 'CHECK (((nome IS NULL) OR ((length(nome) >= 1) AND (length(nome) <= 80) AND (nome = btrim(nome)))))')
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'config_mototaxi: RLS admin atual e ACL', 'sim', CASE WHEN
    COALESCE((SELECT relrowsecurity AND relkind = 'r' FROM tabela), false)
    AND (SELECT count(*) FROM pg_policy WHERE polrelid = to_regclass('public.config_mototaxi')) = 1
    AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.config_mototaxi') AND polname = 'config_mototaxi_admin_select'
      AND polcmd = 'r' AND polpermissive AND polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
      AND polwithcheck IS NULL AND pg_get_expr(polqual,polrelid) = '(is_admin() AND is_admin_atual())')
    AND NOT has_table_privilege('anon', (SELECT oid FROM tabela), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_any_column_privilege('anon', (SELECT oid FROM tabela), 'SELECT,INSERT,UPDATE,REFERENCES')
    AND has_table_privilege('authenticated', (SELECT oid FROM tabela), 'SELECT')
    AND NOT has_table_privilege('authenticated', (SELECT oid FROM tabela), 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_any_column_privilege('authenticated', (SELECT oid FROM tabela), 'INSERT,UPDATE,REFERENCES')
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'salvar_config_mototaxi: corpo exato e atributos', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM fn WHERE md5(replace(prosrc,chr(13),'')) = md5($corpo$
DECLARE
  resultado jsonb;
BEGIN
  IF NOT public.is_admin() OR NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.config_mototaxi (id, whatsapp, nome)
    VALUES (1, NULLIF(btrim(p_whatsapp), ''), NULLIF(btrim(p_nome), ''))
    ON CONFLICT (id) DO UPDATE SET whatsapp = EXCLUDED.whatsapp, nome = EXCLUDED.nome
    RETURNING jsonb_build_object('whatsapp', whatsapp, 'nome', nome) INTO resultado;
  RETURN resultado;
END;
$corpo$)
      AND prosecdef AND lanname = 'plpgsql' AND provolatile = 'v' AND NOT proretset AND NOT proisstrict
      AND pronargs = 2 AND pronargdefaults = 0 AND proconfig = ARRAY['search_path=public']::text[]
      AND pg_get_function_result(oid) = 'jsonb'
      AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'salvar_config_mototaxi') = 1
    ) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'salvar_config_mototaxi: ACL restrita', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM fn WHERE NOT has_function_privilege('anon', oid, 'EXECUTE')
      AND has_function_privilege('authenticated', oid, 'EXECUTE')
      AND has_function_privilege('service_role', oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'contato privado: fora da configuracao publica', 'sim', CASE WHEN
    to_regclass('public.v_store_config') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid IN (to_regclass('public.v_store_config'), to_regclass('public.store_config'))
      AND attname ILIKE '%mototaxi%' AND NOT attisdropped)
    AND NOT EXISTS (SELECT 1 FROM pg_depend WHERE classid = 'pg_rewrite'::regclass AND refobjid = to_regclass('public.config_mototaxi'))
    THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
