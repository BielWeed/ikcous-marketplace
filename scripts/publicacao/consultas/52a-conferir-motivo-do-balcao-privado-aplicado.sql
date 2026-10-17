-- 52a-conferir-motivo-do-balcao-privado-aplicado: somente catalogo, um SELECT, 11 linhas fixas. Nenhum pedido ou nota e lido.
-- DEPOIS: exige o corpo EXATO da 20261249.
-- Nos dois lados a tabela privada tem de estar OPERACIONAL: ausente ou fechada pelo rollback da 247 reprova.
-- Rol FECHADO (item | esperado | vivo | ok booleano, false primeiro); objeto ausente nao elimina linha:
-- 1. controle: funcoes de public visiveis a este papel
-- 2. registrar_venda_presencial: sobrecargas
-- 3. registrar_venda_presencial: corpo da 20261249000000 (motivo privado, md5)
-- 4. registrar_venda_presencial: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=pg_catalog, pg_temp)
-- 5. registrar_venda_presencial: EXECUTE so authenticated, sem GRANT OPTION nem privilegio inesperado
-- 6. marketplace_orders: indice unico valido da chave de idempotencia
-- 7. marketplace_order_internal_notes: forma conhecida (colunas, restricoes, valores padrao, gatilho)
-- 8. marketplace_order_internal_notes: RLS ligada e uma unica politica, so do admin de agora
-- 9. marketplace_order_internal_notes: ACL so authenticated (SELECT, INSERT, UPDATE, DELETE), nada a anon, PUBLIC e service_role
-- 10. marketplace_order_internal_notes: dono certo, fora do realtime e sem ACL de coluna
-- 11. dependencias: marketplace_orders, portas do admin de agora e funcao do carimbo
-- As guardas reproduzem o pre-voo/conferencia da 249: atributos, ACL estrita, indice da chave e dependencia da 247.
-- Limite: catalogo nao prova comportamento nem estado remoto; execute contra o ref antes/depois do apply.
WITH ord AS (
  SELECT c.oid, c.relowner AS dono FROM pg_class c WHERE c.oid = to_regclass('public.marketplace_orders')
), tb AS (
  SELECT c.oid FROM pg_class c WHERE c.oid = to_regclass('public.marketplace_order_internal_notes')
), fn AS (
  SELECT p.oid, p.proowner, p.proacl,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
           AND q.proname = 'registrar_venda_presencial') AS sobrecargas,
         l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
           AND NOT p.proisstrict AND NOT p.proretset AND p.pronargs = 8
           AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
           AND pg_get_function_result(p.oid) = 'jsonb'
           AND p.proowner = (SELECT dono FROM ord) AS atributos
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim', CASE WHEN COALESCE(((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace)), false) THEN 'sim' ELSE 'nao' END

  UNION ALL
  SELECT 'registrar_venda_presencial: sobrecargas', '1',
         COALESCE((SELECT sobrecargas::text FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'registrar_venda_presencial: corpo da 20261249000000 (motivo privado, md5)', '796e0aaeb00b6f5133a54ce12f2df396',
         COALESCE((SELECT m FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'registrar_venda_presencial: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=pg_catalog, pg_temp)', 'sim',
         CASE WHEN COALESCE((SELECT atributos FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'registrar_venda_presencial: EXECUTE so authenticated, sem GRANT OPTION nem privilegio inesperado', 'sim',
         CASE WHEN COALESCE((SELECT has_function_privilege('authenticated', f.oid, 'EXECUTE')
           AND NOT has_function_privilege('anon', f.oid, 'EXECUTE')
           AND NOT has_function_privilege('service_role', f.oid, 'EXECUTE')
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) g
                            WHERE g.grantee <> f.proowner
                              AND (g.grantee <> 'authenticated'::regrole OR g.privilege_type <> 'EXECUTE' OR g.is_grantable))
          FROM fn f), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'marketplace_orders: indice unico valido da chave de idempotencia', 'sim',
         CASE WHEN EXISTS (SELECT 1 FROM pg_index i
                            WHERE i.indexrelid = to_regclass('public.marketplace_orders_chave_da_compra_unica')
                              AND i.indrelid = to_regclass('public.marketplace_orders')
                              AND i.indisunique AND i.indisvalid) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'marketplace_order_internal_notes: forma conhecida (colunas, restricoes, valores padrao, gatilho)', 'sim', CASE WHEN COALESCE(((SELECT relkind = 'r' FROM pg_class WHERE oid = (SELECT oid FROM tb))
    AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
         FROM pg_attribute a WHERE a.attrelid = (SELECT oid FROM tb) AND a.attnum > 0 AND NOT a.attisdropped)
      = 'order_id:uuid:true,note:text:true,updated_at:timestamp with time zone:true,updated_by:uuid:false'
    AND (SELECT string_agg(contype::text || ':' || conname || ':' || replace(pg_get_constraintdef(oid), 'public.', ''), ' | ' ORDER BY conname)
         FROM pg_constraint WHERE conrelid = (SELECT oid FROM tb) AND contype IN ('p', 'f', 'c'))
      = 'c:marketplace_order_internal_notes_note_check:CHECK (((note ~ ''[^[:space:]]''::text) AND (length(note) <= 2000))) | f:marketplace_order_internal_notes_order_id_fkey:FOREIGN KEY (order_id) REFERENCES marketplace_orders(id) ON DELETE CASCADE | p:marketplace_order_internal_notes_pkey:PRIMARY KEY (order_id)'
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = (SELECT oid FROM tb) AND contype NOT IN ('p', 'f', 'c', 'n'))
    AND (SELECT string_agg(a.attname || '=' || pg_get_expr(d.adbin, d.adrelid), ',' ORDER BY a.attnum)
         FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = (SELECT oid FROM tb))
      = 'updated_at=now(),updated_by=auth.uid()'
    AND (SELECT string_agg(t.tgname || ':' || t.tgtype::text || ':' || t.tgenabled::text || ':' || p.proname, ',' ORDER BY t.tgname)
         FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = (SELECT oid FROM tb) AND NOT t.tgisinternal)
      = 'nota_interna_carimba_quem_e_quando:23:O:carimba_nota_interna_do_pedido'
    AND (SELECT count(*) FROM pg_index WHERE indrelid = (SELECT oid FROM tb)) = 1), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'marketplace_order_internal_notes: RLS ligada e uma unica politica, so do admin de agora', 'sim', CASE WHEN COALESCE(((SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid = (SELECT oid FROM tb)) AND (SELECT count(*) FROM pg_policy WHERE polrelid = (SELECT oid FROM tb)) = 1
    AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = (SELECT oid FROM tb) AND polname = 'nota_interna_so_admin_atual'
            AND polcmd = '*' AND polpermissive AND polroles = ARRAY['authenticated'::regrole::oid]
            AND replace(pg_get_expr(polqual, polrelid), 'public.', '') = '( SELECT rls_admin_atual() AS rls_admin_atual)'
            AND replace(pg_get_expr(polwithcheck, polrelid), 'public.', '') = '( SELECT rls_admin_atual() AS rls_admin_atual)')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'marketplace_order_internal_notes: ACL so authenticated (SELECT, INSERT, UPDATE, DELETE), nada a anon, PUBLIC e service_role', 'sim', CASE WHEN COALESCE(((SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE c.oid = (SELECT oid FROM tb) AND g.grantee <> c.relowner) = 4
    AND (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE c.oid = (SELECT oid FROM tb) AND g.grantee <> c.relowner
           AND g.grantee = 'authenticated'::regrole AND g.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE') AND NOT g.is_grantable) = 4), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'marketplace_order_internal_notes: dono certo, fora do realtime e sem ACL de coluna', 'sim', CASE WHEN COALESCE(((SELECT relrowsecurity AND NOT relforcerowsecurity AND relowner = (SELECT dono FROM ord) FROM pg_class WHERE oid = (SELECT oid FROM tb))
    AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = (SELECT oid FROM tb) AND attacl IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'marketplace_order_internal_notes')), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'dependencias: marketplace_orders, portas do admin de agora e funcao do carimbo', 'sim', CASE WHEN COALESCE(((SELECT relkind = 'r' FROM pg_class WHERE oid = to_regclass('public.marketplace_orders'))
    AND (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_orders') AND a.attname = 'id' AND NOT a.attisdropped) = 'uuid'
    AND to_regprocedure('public.is_admin_atual()') IS NOT NULL
    AND to_regprocedure('public.rls_admin_atual()') IS NOT NULL
    AND to_regprocedure('auth.uid()') IS NOT NULL
    AND has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE')
    AND NOT has_function_privilege('anon', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE')
    AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
             WHERE p.oid = to_regprocedure('public.carimba_nota_interna_do_pedido()') AND l.lanname = 'plpgsql' AND p.prokind = 'f'
               AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
               AND pg_get_function_result(p.oid) = 'trigger' AND p.proowner = (SELECT dono FROM ord)
               AND md5(replace(p.prosrc, chr(13), '')) = '1b50478b0ec83b91c2ec82b0f5a5edb6'
               AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g WHERE g.grantee <> p.proowner))), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
