-- Rollback comum 20261247000000: FECHA a porta da anotação interna e PRESERVA os dados.
-- Apaga a política e revoga os privilégios de authenticated; DEIXA a tabela, as linhas, o
-- gatilho, a função do carimbo e a RLS ligada (ninguém além do dono do banco lê as notas).
-- Retire o front novo ANTES: com ele no ar, salvar a anotação passa a falhar. As anotações
-- antigas continuam em marketplace_orders.notes (esta migration nunca as tocou).
-- Reaplicar a 20261247000000 abre a porta de novo e as notas voltam. Idempotente: rodar 2x é igual.
-- Apagar a tabela é outro arquivo, só com o dono: rollback-manual-destrutivo-20261247000000_*.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261247$
DECLARE
  v_orders oid := to_regclass('public.marketplace_orders');
  v_t oid := to_regclass('public.marketplace_order_internal_notes');
  v_dono oid;
BEGIN
  IF v_orders IS NULL OR NOT COALESCE((SELECT relkind = 'r' FROM pg_class WHERE oid = to_regclass('public.marketplace_orders'))
    AND (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_orders') AND a.attname = 'id' AND NOT a.attisdropped) = 'uuid', false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_orders ausente ou sem id uuid.';
  END IF;
  SELECT relowner INTO v_dono FROM pg_class WHERE oid = v_orders;
  IF NOT COALESCE(to_regprocedure('public.is_admin_atual()') IS NOT NULL
    AND to_regprocedure('public.rls_admin_atual()') IS NOT NULL
    AND to_regprocedure('auth.uid()') IS NOT NULL
    AND has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE')
    AND NOT has_function_privilege('anon', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam as portas do admin de agora (is_admin_atual, rls_admin_atual para authenticated, auth.uid).';
  END IF;
  IF to_regprocedure('public.carimba_nota_interna_do_pedido()') IS NOT NULL AND NOT COALESCE(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
             WHERE p.oid = to_regprocedure('public.carimba_nota_interna_do_pedido()') AND l.lanname = 'plpgsql' AND p.prokind = 'f'
               AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
               AND pg_get_function_result(p.oid) = 'trigger' AND p.proowner = v_dono
               AND md5(replace(p.prosrc, chr(13), '')) = '1b50478b0ec83b91c2ec82b0f5a5edb6'
               AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g WHERE g.grantee <> p.proowner)), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: carimba_nota_interna_do_pedido já existe com corpo, atributos ou ACL divergentes.';
  END IF;
  IF v_t IS NOT NULL THEN
    IF NOT COALESCE((SELECT relkind = 'r' FROM pg_class WHERE oid = v_t)
      AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
           FROM pg_attribute a WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped)
        = 'order_id:uuid:true,note:text:true,updated_at:timestamp with time zone:true,updated_by:uuid:false'
      AND (SELECT string_agg(contype::text || ':' || conname || ':' || replace(pg_get_constraintdef(oid), 'public.', ''), ' | ' ORDER BY conname)
           FROM pg_constraint WHERE conrelid = v_t AND contype IN ('p', 'f', 'c'))
        = 'c:marketplace_order_internal_notes_note_check:CHECK (((note ~ ''[^[:space:]]''::text) AND (length(note) <= 2000))) | f:marketplace_order_internal_notes_order_id_fkey:FOREIGN KEY (order_id) REFERENCES marketplace_orders(id) ON DELETE CASCADE | p:marketplace_order_internal_notes_pkey:PRIMARY KEY (order_id)'
      AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = v_t AND contype NOT IN ('p', 'f', 'c', 'n'))
      AND (SELECT string_agg(a.attname || '=' || pg_get_expr(d.adbin, d.adrelid), ',' ORDER BY a.attnum)
           FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = v_t)
        = 'updated_at=now(),updated_by=auth.uid()'
      AND (SELECT string_agg(t.tgname || ':' || t.tgtype::text || ':' || t.tgenabled::text || ':' || p.proname, ',' ORDER BY t.tgname)
           FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = v_t AND NOT t.tgisinternal)
        = 'nota_interna_carimba_quem_e_quando:23:O:carimba_nota_interna_do_pedido'
      AND (SELECT count(*) FROM pg_index WHERE indrelid = v_t) = 1
       AND (SELECT relrowsecurity AND NOT relforcerowsecurity AND relowner = v_dono FROM pg_class WHERE oid = v_t)
      AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_t AND attacl IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'marketplace_order_internal_notes')
       AND (((SELECT count(*) FROM pg_policy WHERE polrelid = v_t) = 1
          AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_t AND polname = 'nota_interna_so_admin_atual'
                  AND polcmd = '*' AND polpermissive AND polroles = ARRAY['authenticated'::regrole::oid]
                  AND replace(pg_get_expr(polqual, polrelid), 'public.', '') = '( SELECT rls_admin_atual() AS rls_admin_atual)'
                  AND replace(pg_get_expr(polwithcheck, polrelid), 'public.', '') = '( SELECT rls_admin_atual() AS rls_admin_atual)')
         AND (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE c.oid = v_t AND g.grantee <> c.relowner) = 4
          AND (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE c.oid = v_t AND g.grantee <> c.relowner
                 AND g.grantee = 'authenticated'::regrole AND g.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE') AND NOT g.is_grantable) = 4)
        OR (NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_t)
         AND NOT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE c.oid = v_t AND g.grantee <> c.relowner))), false) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_order_internal_notes em estado desconhecido: o rollback não fecha o que não reconhece.';
    END IF;
  END IF;
END $preflight_rollback_20261247$;

DO $fecha_20261247$
BEGIN
  IF to_regclass('public.marketplace_order_internal_notes') IS NOT NULL THEN
    DROP POLICY IF EXISTS nota_interna_so_admin_atual ON public.marketplace_order_internal_notes;
    REVOKE ALL ON TABLE public.marketplace_order_internal_notes FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END $fecha_20261247$;

DO $conferencia_rollback_20261247$
DECLARE
  v_orders oid := to_regclass('public.marketplace_orders');
  v_t oid := to_regclass('public.marketplace_order_internal_notes');
  v_dono oid;
BEGIN
  IF v_orders IS NULL OR NOT COALESCE((SELECT relkind = 'r' FROM pg_class WHERE oid = to_regclass('public.marketplace_orders'))
    AND (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_orders') AND a.attname = 'id' AND NOT a.attisdropped) = 'uuid', false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_orders ausente ou sem id uuid.';
  END IF;
  SELECT relowner INTO v_dono FROM pg_class WHERE oid = v_orders;
  IF NOT COALESCE(to_regprocedure('public.is_admin_atual()') IS NOT NULL
    AND to_regprocedure('public.rls_admin_atual()') IS NOT NULL
    AND to_regprocedure('auth.uid()') IS NOT NULL
    AND has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE')
    AND NOT has_function_privilege('anon', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam as portas do admin de agora (is_admin_atual, rls_admin_atual para authenticated, auth.uid).';
  END IF;
  IF to_regprocedure('public.carimba_nota_interna_do_pedido()') IS NOT NULL AND NOT COALESCE(EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
             WHERE p.oid = to_regprocedure('public.carimba_nota_interna_do_pedido()') AND l.lanname = 'plpgsql' AND p.prokind = 'f'
               AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
               AND pg_get_function_result(p.oid) = 'trigger' AND p.proowner = v_dono
               AND md5(replace(p.prosrc, chr(13), '')) = '1b50478b0ec83b91c2ec82b0f5a5edb6'
               AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g WHERE g.grantee <> p.proowner)), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: carimba_nota_interna_do_pedido já existe com corpo, atributos ou ACL divergentes.';
  END IF;
  IF v_t IS NOT NULL THEN
    IF NOT COALESCE((SELECT relkind = 'r' FROM pg_class WHERE oid = v_t)
      AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
           FROM pg_attribute a WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped)
        = 'order_id:uuid:true,note:text:true,updated_at:timestamp with time zone:true,updated_by:uuid:false'
      AND (SELECT string_agg(contype::text || ':' || conname || ':' || replace(pg_get_constraintdef(oid), 'public.', ''), ' | ' ORDER BY conname)
           FROM pg_constraint WHERE conrelid = v_t AND contype IN ('p', 'f', 'c'))
        = 'c:marketplace_order_internal_notes_note_check:CHECK (((note ~ ''[^[:space:]]''::text) AND (length(note) <= 2000))) | f:marketplace_order_internal_notes_order_id_fkey:FOREIGN KEY (order_id) REFERENCES marketplace_orders(id) ON DELETE CASCADE | p:marketplace_order_internal_notes_pkey:PRIMARY KEY (order_id)'
      AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = v_t AND contype NOT IN ('p', 'f', 'c', 'n'))
      AND (SELECT string_agg(a.attname || '=' || pg_get_expr(d.adbin, d.adrelid), ',' ORDER BY a.attnum)
           FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = v_t)
        = 'updated_at=now(),updated_by=auth.uid()'
      AND (SELECT string_agg(t.tgname || ':' || t.tgtype::text || ':' || t.tgenabled::text || ':' || p.proname, ',' ORDER BY t.tgname)
           FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = v_t AND NOT t.tgisinternal)
        = 'nota_interna_carimba_quem_e_quando:23:O:carimba_nota_interna_do_pedido'
      AND (SELECT count(*) FROM pg_index WHERE indrelid = v_t) = 1
       AND (SELECT relrowsecurity AND NOT relforcerowsecurity AND relowner = v_dono FROM pg_class WHERE oid = v_t)
      AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_t AND attacl IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'marketplace_order_internal_notes')
       AND (NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_t)
        AND NOT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE c.oid = v_t AND g.grantee <> c.relowner)), false) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_order_internal_notes não ficou fechada (sem política e sem privilégios).';
    END IF;
  END IF;
END $conferencia_rollback_20261247$;
