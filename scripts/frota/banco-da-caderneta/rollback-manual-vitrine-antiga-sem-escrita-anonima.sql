-- ============================================================================
-- Rollback — a vitrine antiga sem escrita anônima (banco da caderneta, projeto antigo dekxabvqdsuukijblazl)
-- ============================================================================
-- Desfaz vitrine-antiga-sem-escrita-anonima.sql: GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN de volta a anon e
-- authenticated em public.vw_produtos_public. Rodado pelo dono (postgres), por membro dele ou por superusuário, o GRANT sai com
-- postgres como concedente e a ACL volta byte a byte à medida em 26/11/2026:
--   {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
-- (o Postgres atualiza as entradas de anon e authenticated no lugar: a ordem não muda).
-- COM ELE VOLTA O FURO: qualquer um com a chave pública volta a escrever e apagar produto do app antigo pela view.
-- DADOS: nenhuma linha é tocada e nenhum conteúdo é lido (o pré-voo só pergunta SE existe linha, por EXISTS: no registro de
-- migrations e na caderneta); muda só a ACL da view, nas entradas de anon e authenticated.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT), ANTES de tudo, se o banco é de LOJA: a ACL que ele aceita é IDÊNTICA à das lojas
-- atuais, e numa loja ele reabriria a escrita anônima na vitrine dela. A caderneta semeada NÃO separa mais: o plano copia a
-- caderneta para a CAF (PLANO-CADERNETA-FORA-DO-DEKXAB, item 3 do crítico). O que separa é o que só banco de CANAL tem:
--   - o registro de migrations (supabase_migrations.schema_migrations) com a 20261090000000 ou a 20261500000000. O portão de
--     release exige toda versão no registro de cada loja assinante (publicar-release.mjs, "ausente do ledger"); a 20261090000000
--     é a que fechou ESTA view nas lojas, e o dekxab (fora dos workflows de banco: lojas.json) tem a view medida aberta, sem o
--     efeito dela; a 20261500000000 (26/11) só vai aos canais;
--   - ou a tabela public.saude_da_reconciliacao, que a 20261500000000 cria (pega loja com lacuna no registro).
-- Sem o registro de migrations não dá para provar que não é loja: recusa também. Só então a caderneta semeada (necessária, não
-- suficiente). Depois, recusa se a view não existe, quem roda não age como o dono, há privilégio de coluna, ou a ACL não é a
-- que o script deixa nem a medida (já desfeito: rodar de novo é no-op). PÓS-VOO: recusa se a ACL não voltou EXATAMENTE à
-- medida. Sem BEGIN/COMMIT neste arquivo: pelo execute_sql do MCP, "begin;" antes e "commit;" depois, na mesma chamada.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_vitrine_antiga$
DECLARE
  v_view oid := to_regclass('public.vw_produtos_public');
  v_acl text;
BEGIN
  -- Antes de tudo: NÃO é banco de loja. A ACL que este rollback aceita é IDÊNTICA à das lojas atuais; rodado numa loja por
  -- engano, ele devolveria a escrita anônima na vitrine dela. A caderneta semeada não separa (a CAF vai recebê-la): quem
  -- separa é o registro de migrations de canal e a tabela da 20261500000000 (ver o cabeçalho).
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: sem supabase_migrations.schema_migrations, nada prova que este banco não é de loja — script só para o dekxab; meça o banco.';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version IN ('20261090000000', '20261500000000'))
     OR to_regclass('public.saude_da_reconciliacao') IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: este banco é de loja (registra migration de canal ou tem public.saude_da_reconciliacao) — o rollback reabriria a escrita anônima na vitrine dela; script só para o dekxab.';
  END IF;
  -- Necessário, não suficiente: o banco hospeda uma caderneta semeada (o dekxab hospeda a de produção hoje).
  IF to_regclass('public.frota_lojas') IS NULL OR to_regclass('public.frota_segredo') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: este banco não é o da caderneta (sem public.frota_lojas/frota_segredo) — script só para o banco da caderneta.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.frota_segredo) OR NOT EXISTS (SELECT 1 FROM public.frota_lojas) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a caderneta deste banco está vazia (sem segredo ou sem loja) — não é o dekxab com a caderneta; script só para ele.';
  END IF;
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
