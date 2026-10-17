-- ============================================================================
-- Migration 20261247000000 — a anotação interna do pedido não chega ao celular da cliente
-- (dado de cliente + permissão)
-- ============================================================================
-- O DEFEITO: o painel grava a "Anotação interna" da lojista em marketplace_orders.notes. Essa
-- coluna é lida pelo celular da cliente (select * dos pedidos do próprio user_id e o realtime
-- da linha): o que a lojista escreve de interno chega ao aparelho da cliente.
--
-- O QUE ESTA MIGRATION FAZ: cria a tabela public.marketplace_order_internal_notes (uma anotação por pedido, no máximo
-- 2000 caracteres e nunca em branco), SÓ do admin de agora. A coluna notes NÃO muda: ela
-- continua guardando a observação da cliente, a variante e a frase "Frete Escolhido: ...".
-- Esta migration não lê, não copia e não reescreve nenhuma nota existente (SEM backfill):
-- as anotações antigas continuam em notes até uma segunda migration, depois do front no ar.
--
-- QUEM LÊ E ESCREVE: RLS ligada, UMA política FOR ALL só para o papel authenticated, com
-- USING e WITH CHECK em (SELECT public.rls_admin_atual()) — a porta feita para políticas
-- (20261197000000): lê o papel de AGORA em auth.users E em profiles, nunca o app_metadata do
-- JWT. public.is_admin_atual() NÃO serve em política: é privada, sem EXECUTE para authenticated.
-- Admin rebaixado no banco, ainda com JWT de admin, é recusado. Dono do pedido (a cliente),
-- outra cliente e anon não leem nem escrevem nada. Grants: REVOKE ALL explícito de PUBLIC,
-- anon, authenticated e service_role (a ACL varia entre lojas), depois só SELECT, INSERT,
-- UPDATE e DELETE ao authenticated. A tabela NÃO entra na publicação do realtime.
--
-- QUEM ESCREVEU E QUANDO: o gatilho BEFORE INSERT OR UPDATE carimba updated_at = now() e
-- updated_by = auth.uid() no servidor (o painel não envia; o que enviar é ignorado). updated_by
-- é uuid SEM chave estrangeira para auth.users, para não travar a exclusão de conta. O helper
-- handle_updated_at() do repositório não serve: só cuida de updated_at.
-- A nota apaga junto com o pedido (ON DELETE CASCADE).
--
-- PRÉ-VOO / B1_BASELINE_DIVERGENT: antes de qualquer escrita, recusa se faltar marketplace_orders
-- (com id uuid), is_admin_atual, rls_admin_atual (com EXECUTE para authenticated) ou auth.uid;
-- se a função do carimbo existir com corpo/atributos/ACL diferentes; ou se a tabela já existir
-- com colunas, restrições, valores padrão, gatilho, RLS, política, ACL ou publicação diferentes.
-- Aceita a tabela ausente, no estado desta migration (política + 4 privilégios) ou no estado
-- que o rollback comum deixa (sem política e sem privilégios).
-- Aplicar 2x é idêntico (CREATE ... IF NOT EXISTS, DROP/CREATE POLICY e TRIGGER, REVOKE/GRANT
-- repetíveis). Sem BEGIN/COMMIT: o aplicador abre a transação. lock_timeout 5s /
-- statement_timeout 30s: aplicar fora do horário de pico (a tabela é nova e minúscula; o único
-- lock é o do CREATE e o do ALTER na própria tabela).
-- ROLLBACK EM DOIS DEGRAUS: o comum FECHA a porta (apaga a política e revoga os privilégios) e
-- PRESERVA a tabela, as linhas, o gatilho e a RLS ligada; reaplicar abre de novo e as notas
-- voltam. Apagar a tabela é rollback-manual-destrutivo separado, só com o dono.
-- ORDEM: banco antes do front. Front antigo continua funcionando (nada que ele usa mudou).
-- PROVAS: tests/banco/nota-interna-do-pedido-viva.cjs (PG17, papéis reais, mutantes) e
-- tests/migration_a_nota_interna_do_pedido_nao_chega_a_cliente_test.ts (texto e hashes).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261247$
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
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_order_internal_notes já existe com forma, RLS, política, ACL ou gatilho divergentes.';
    END IF;
  END IF;
END $preflight_20261247$;

CREATE OR REPLACE FUNCTION public.carimba_nota_interna_do_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$
BEGIN
  -- Quem escreveu e quando vêm do SERVIDOR: o painel não envia, e o que enviar é ignorado.
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.carimba_nota_interna_do_pedido() FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.marketplace_order_internal_notes (
  order_id uuid PRIMARY KEY REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  note text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid(),
  CONSTRAINT marketplace_order_internal_notes_note_check CHECK (note ~ '[^[:space:]]' AND length(note) <= 2000)
);
ALTER TABLE public.marketplace_order_internal_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketplace_order_internal_notes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.marketplace_order_internal_notes TO authenticated;

DROP TRIGGER IF EXISTS nota_interna_carimba_quem_e_quando ON public.marketplace_order_internal_notes;
CREATE TRIGGER nota_interna_carimba_quem_e_quando
  BEFORE INSERT OR UPDATE ON public.marketplace_order_internal_notes
  FOR EACH ROW EXECUTE FUNCTION public.carimba_nota_interna_do_pedido();

DROP POLICY IF EXISTS nota_interna_so_admin_atual ON public.marketplace_order_internal_notes;
CREATE POLICY nota_interna_so_admin_atual ON public.marketplace_order_internal_notes
  FOR ALL TO authenticated
  USING ((SELECT public.rls_admin_atual()))
  WITH CHECK ((SELECT public.rls_admin_atual()));

DO $conferencia_20261247$
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
       AND ((SELECT count(*) FROM pg_policy WHERE polrelid = v_t) = 1
        AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_t AND polname = 'nota_interna_so_admin_atual'
                AND polcmd = '*' AND polpermissive AND polroles = ARRAY['authenticated'::regrole::oid]
                AND replace(pg_get_expr(polqual, polrelid), 'public.', '') = '( SELECT rls_admin_atual() AS rls_admin_atual)'
                AND replace(pg_get_expr(polwithcheck, polrelid), 'public.', '') = '( SELECT rls_admin_atual() AS rls_admin_atual)')
        AND (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE c.oid = v_t AND g.grantee <> c.relowner) = 4
        AND (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE c.oid = v_t AND g.grantee <> c.relowner
               AND g.grantee = 'authenticated'::regrole AND g.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE') AND NOT g.is_grantable) = 4), false) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: marketplace_order_internal_notes já existe com forma, RLS, política, ACL ou gatilho divergentes.';
    END IF;
  END IF;
END $conferencia_20261247$;
