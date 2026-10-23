-- 88b-antes-so-o-dono-define-cargo-ausente: ANTES da 20261383000000 (ou depois do rollback-manual-destrutivo dela). SO LEITURA, somente
-- catalogo, rol fechado de 8 linhas. Nao le nenhuma linha. O rollback-manual COMUM mantem as duas tabelas (e as linhas): depois dele
-- a linha das tabelas fica "nao" de proposito e so o destrutivo as apaga.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'definir_cargo e papel_so_pelo_definir_cargo: ainda NAO existem', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('definir_cargo', 'papel_so_pelo_definir_cargo')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'gatilho tr_papel_so_pelo_definir_cargo: ainda NAO existe em profiles', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.profiles') AND t.tgname = 'tr_papel_so_pelo_definir_cargo' AND NOT t.tgisinternal) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'dono_da_loja e cargo_log: ainda NAO existem', 'sim', CASE WHEN to_regclass('public.dono_da_loja') IS NULL AND to_regclass('public.cargo_log') IS NULL THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'as portas do admin atual existem com o corpo da 20261197000000 (md5) e rls_admin_atual() executavel pelo authenticated', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) = 2 AND bool_and(CASE p.proname WHEN 'is_admin_atual' THEN md5(replace(p.prosrc, chr(13), '')) = '519842163e48cc377ac1337ffb9db936'
                                    ELSE md5(replace(p.prosrc, chr(13), '')) = 'ccb7a56e835b8181795fffb7bee97305' END)
       FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.is_admin_atual()'), to_regprocedure('public.rls_admin_atual()'))), false)
    AND COALESCE(has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'os tres gatilhos de papel da 20261199000000 existem, ligados, com os corpos (md5) que a migration supoe', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) = 3 AND bool_and(t.tgenabled = 'O') FROM pg_trigger t
      WHERE t.tgrelid = to_regclass('public.profiles') AND NOT t.tgisinternal
        AND t.tgname IN ('tr_ensure_role_protection', 'tr_prevent_role_change', 'tr_sync_profile_role_to_auth')), false)
    AND COALESCE((SELECT count(*) = 3 FROM pg_proc p WHERE
        (p.oid = to_regprocedure('public.ensure_role_protection()') AND md5(replace(p.prosrc, chr(13), '')) = '44d677c3fa562318668122aad65fe0df')
     OR (p.oid = to_regprocedure('public.prevent_role_change()') AND md5(replace(p.prosrc, chr(13), '')) = '92ff3224c34e3367cdf892579e8176f0')
     OR (p.oid = to_regprocedure('public.handle_profile_role_sync_to_auth()') AND md5(replace(p.prosrc, chr(13), '')) = 'e63371757c43ef2619dd613af4635ad3')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a ordem dos gatilhos BEFORE UPDATE de profiles deixa o nome novo entre tr_ensure_role_protection e tr_prevent_role_change', 'sim', CASE WHEN COALESCE(
    (SELECT array_position(o, 'tr_ensure_role_protection') < array_position(o, 'tr_papel_so_pelo_definir_cargo')
        AND array_position(o, 'tr_papel_so_pelo_definir_cargo') < array_position(o, 'tr_prevent_role_change')
       FROM (SELECT array_agg(n ORDER BY n COLLATE "C") AS o FROM (
         SELECT t.tgname::text AS n FROM pg_trigger t
          WHERE t.tgrelid = to_regclass('public.profiles') AND NOT t.tgisinternal
            AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16
         UNION SELECT 'tr_papel_so_pelo_definir_cargo') y) x), false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'profiles.role e auth.users.raw_app_meta_data existem e profiles tem RLS ligada', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_attribute WHERE attrelid = to_regclass('public.profiles') AND attname IN ('id', 'role') AND NOT attisdropped AND attnum > 0) = 2
    AND (SELECT count(*) FROM pg_attribute WHERE attrelid = to_regclass('auth.users') AND attname IN ('id', 'raw_app_meta_data') AND NOT attisdropped AND attnum > 0) = 2
    AND EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.profiles') AND relkind = 'r' AND relrowsecurity) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
