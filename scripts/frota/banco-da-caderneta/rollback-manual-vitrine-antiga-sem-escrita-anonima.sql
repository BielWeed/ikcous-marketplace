-- ============================================================================
-- Rollback — a vitrine antiga sem escrita anônima (banco da caderneta, projeto antigo dekxabvqdsuukijblazl)
-- ============================================================================
-- Desfaz vitrine-antiga-sem-escrita-anonima.sql: GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN de volta a anon e
-- authenticated em public.vw_produtos_public. Rodado pelo dono (postgres), por membro dele ou por superusuário, o GRANT sai com
-- postgres como concedente e a ACL volta byte a byte à medida em 26/11/2026:
--   {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
-- (o Postgres atualiza as entradas de anon e authenticated no lugar: a ordem não muda).
-- COM ELE VOLTA O FURO: qualquer um com a chave pública volta a escrever e apagar produto do app antigo pela view.
-- DADOS: nenhuma linha é lida nem tocada; muda só a ACL da view, nas entradas de anon e authenticated.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se a view não existe, quem roda não age como o dono, há privilégio de coluna, ou a ACL
-- não é a que o script deixa nem a medida (já desfeito: rodar de novo é no-op). PÓS-VOO: recusa se a ACL não voltou EXATAMENTE
-- à medida. Sem BEGIN/COMMIT neste arquivo: pelo execute_sql do MCP, "begin;" antes e "commit;" depois, na mesma chamada.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_vitrine_antiga$
DECLARE
  v_view oid := to_regclass('public.vw_produtos_public');
  v_acl text;
BEGIN
  IF v_view IS NULL OR (SELECT c.relkind FROM pg_class c WHERE c.oid = v_view) IS DISTINCT FROM 'v'
     OR (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = v_view) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.vw_produtos_public não existe, não é view ou não é do postgres — nada a reverter aqui; meça o banco.';
  END IF;
  IF NOT (pg_has_role(current_user, 'postgres', 'MEMBER')
          OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = current_user AND r.rolsuper)) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não age como o dono da view (postgres) — rode como postgres.', current_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_view AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.vw_produtos_public tem privilégio de coluna — alguém mexeu depois; meça o banco.';
  END IF;
  SELECT c.relacl::text INTO v_acl FROM pg_class c WHERE c.oid = v_view;
  IF v_acl IS DISTINCT FROM '{postgres=arwdDxtm/postgres,anon=rx/postgres,authenticated=rx/postgres,service_role=arwdDxtm/postgres}'
     AND v_acl IS DISTINCT FROM '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a ACL viva de public.vw_produtos_public é % — nem a que o script deixa nem a medida em 26/11; nada foi desfeito, meça o banco.', v_acl;
  END IF;
END $preflight_rollback_vitrine_antiga$;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN ON public.vw_produtos_public TO anon, authenticated;

DO $posvoo_rollback_vitrine_antiga$
DECLARE
  v_view oid := to_regclass('public.vw_produtos_public');
BEGIN
  IF (SELECT c.relacl::text FROM pg_class c WHERE c.oid = v_view)
     IS DISTINCT FROM '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}' THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_VITRINE_ANTIGA: a ACL de public.vw_produtos_public não voltou à medida (%)',
      (SELECT c.relacl::text FROM pg_class c WHERE c.oid = v_view);
  END IF;
END $posvoo_rollback_vitrine_antiga$;

-- Privilégio mudou: recarrega o schema cache do PostgREST. Idempotente.
NOTIFY pgrst, 'reload schema';
