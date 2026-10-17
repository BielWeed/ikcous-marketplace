-- 50b-antes-nota-interna-do-pedido-base-vigente: somente catalogo, 6 linhas fixas; nenhuma nota interna e lida.
-- Aceita a tabela ausente OU preservada fechada pelo rollback comum (sem politica e sem privilegios).
WITH ord AS (
  SELECT c.oid, c.relowner AS dono FROM pg_class c WHERE c.oid = to_regclass('public.marketplace_orders')
), tb AS (
  SELECT c.oid FROM pg_class c WHERE c.oid = to_regclass('public.marketplace_order_internal_notes')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim', CASE WHEN COALESCE(((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'marketplace_order_internal_notes: forma conhecida (colunas, restricoes, valores padrao, gatilho)', 'sim', CASE WHEN COALESCE((NOT EXISTS (SELECT 1 FROM tb) OR (SELECT relkind = 'r' FROM pg_class WHERE oid = (SELECT oid FROM tb))
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
  SELECT 'marketplace_order_internal_notes: RLS ligada e uma unica politica, so do admin de agora', 'sim', CASE WHEN COALESCE((NOT EXISTS (SELECT 1 FROM tb) OR (SELECT relrowsecurity FROM pg_class WHERE oid = (SELECT oid FROM tb)) AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = (SELECT oid FROM tb))), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'marketplace_order_internal_notes: ACL so authenticated (SELECT, INSERT, UPDATE, DELETE), nada a anon, PUBLIC e service_role', 'sim', CASE WHEN COALESCE((NOT EXISTS (SELECT 1 FROM tb) OR NOT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE c.oid = (SELECT oid FROM tb) AND g.grantee <> c.relowner)), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'marketplace_order_internal_notes: dono certo, fora do realtime e sem ACL de coluna', 'sim', CASE WHEN COALESCE((NOT EXISTS (SELECT 1 FROM tb) OR (SELECT relrowsecurity AND NOT relforcerowsecurity AND relowner = (SELECT dono FROM ord) FROM pg_class WHERE oid = (SELECT oid FROM tb))
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
    AND (to_regprocedure('public.carimba_nota_interna_do_pedido()') IS NULL OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
             WHERE p.oid = to_regprocedure('public.carimba_nota_interna_do_pedido()') AND l.lanname = 'plpgsql' AND p.prokind = 'f'
               AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
               AND pg_get_function_result(p.oid) = 'trigger' AND p.proowner = (SELECT dono FROM ord)
               AND md5(replace(p.prosrc, chr(13), '')) = '1b50478b0ec83b91c2ec82b0f5a5edb6'
               AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g WHERE g.grantee <> p.proowner)))), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
