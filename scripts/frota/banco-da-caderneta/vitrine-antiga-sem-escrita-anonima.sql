-- ============================================================================
-- Banco da caderneta (projeto antigo dekxabvqdsuukijblazl) — a vitrine antiga deixa de aceitar escrita anônima (26/11/2026)
-- NÃO É MIGRATION: só para o banco onde a caderneta de produção mora (IKCOUS_FROTA_URL, hoje o dekxab), aplicado pela sessão
-- pelo MCP. A ACL NÃO separa este banco das lojas atuais (a "já aplicada" é idêntica à delas): quem recusa uma loja é a
-- primeira trava do pré-voo, a caderneta semeada (item 4).
-- APOSENTADO DEPOIS DA VIRADA (docs/runbooks/caderneta-muda-de-banco.md): vale SÓ para o dekxabvqdsuukijblazl. Depois que a
-- caderneta for copiada para o banco da IKCOUS, a trava "caderneta semeada" passa a aceitar também aquele banco; lá a ACL da view
-- já é a das lojas e o REVOKE não muda nada, mas não há motivo para rodá-lo. Não rodar fora do dekxab.
-- ============================================================================
--
-- 1. O QUE ESTÁ ABERTO (medido em 26/11/2026, só leitura, no dekxab)
--
-- public.vw_produtos_public é uma view SEM security_invoker (roda como o dono, postgres, que é isento do RLS de produtos) e
-- auto-atualizável, com a ACL
--   {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
-- Ou seja: qualquer um com a chave pública do projeto faz POST/PATCH/DELETE em produtos do app antigo (parado desde 30/09) pela
-- API, e pode encher o disco do projeto que hospeda a caderneta de TODAS as lojas. Nas lojas atuais isso foi fechado pela
-- 20260821000100 (INSERT, UPDATE, DELETE) e pela 20261090000000 (TRUNCATE, TRIGGER, MAINTAIN — MAINTAIN autoriza LOCK numa view,
-- que tranca recursivamente produtos: negação de serviço barata). O dekxab não recebe migrations dos canais e ficou para trás.
--
-- 2. O QUE ESTE SCRIPT FAZ
--
--   REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN ON public.vw_produtos_public FROM anon, authenticated — e nada mais.
--   É a SOMA do que a 20260821000100 e a 20261090000000 tiraram da view nas lojas: o dekxab fica com a MESMA ACL das lojas,
--   {postgres=arwdDxtm/postgres,anon=rx/postgres,authenticated=rx/postgres,service_role=arwdDxtm/postgres}.
--   Ficam SELECT (a vitrine antiga lê por ela; todo uso em src/ é .select) e REFERENCES (inerte numa view: chave estrangeira só
--   aponta para tabela; as lojas também o mantêm). postgres e service_role intocados. NÃO liga security_invoker (mudaria o que a
--   vitrine antiga lê: o anon não tem SELECT em produtos) e não mexe em nenhum outro objeto.
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha é escrita ou apagada, e nenhum conteúdo é lido: o pré-voo só pergunta SE frota_segredo e frota_lojas têm linha
-- (EXISTS); o resto é catálogo. Muda só pg_class.relacl da view, nas entradas de anon e authenticated. Aplicar duas vezes deixa
-- o mesmo estado: o pré-voo aceita também a ACL já aplicada, e revogar o já revogado é no-op.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, antes de qualquer escrita)
--
-- Recusa, ANTES de tudo, se o banco não é o da caderneta de produção: sem public.frota_lojas/frota_segredo, ou com elas vazias.
-- As tabelas sozinhas não bastam (a 20261141 e as irmãs vão também ao banco de cada loja do canal, onde nascem e ficam vazias:
-- o segredo e as lojas só são semeados na caderneta de produção). LIMITE: com a caderneta copiada para o banco de uma loja (o
-- plano a leva à CAF), esta trava deixa de separá-los. Aqui isso não abre nada: numa loja a ACL já é a "já aplicada" e o
-- REVOKE não muda nada. Quem DEVOLVE a escrita é o rollback, e por isso ele recusa banco de loja por outra trava, o registro
-- de migrations de canal (ver o cabeçalho dele). Depois, recusa se: anon, authenticated ou service_role não
-- existem; a view não existe ou não é view; o dono não é postgres; quem aplica não é o dono (nem membro dele, nem
-- superusuário) — aí o REVOKE viraria só um aviso e o GRANT do rollback sairia com outro concedente; existe privilégio de
-- COLUNA na view (o REVOKE de tabela o levaria junto e o rollback não o devolveria); ou a ACL não é, byte a byte, a medida
-- (acima) nem a já aplicada. Em qualquer desses casos, meça o banco antes.
--
-- 5. TRANSAÇÃO
--
-- Sem BEGIN/COMMIT neste arquivo: quem aplica abre a transação (no execute_sql do MCP, "begin;" antes e "commit;" depois, na
-- mesma chamada). Pré-voo, REVOKE e pós-voo caem juntos ou não caem. GRANT/REVOKE não pede trava da view; lock_timeout de 5 s.
--
-- 6. CONFERIR E DESFAZER
--
-- Conferência: vitrine-antiga-sem-escrita-anonima-conferir.sql (só leitura). Rollback: rollback-manual-vitrine-antiga-sem-escrita-anonima.sql
-- devolve a ACL medida, byte a byte. Prova offline da forma: tests/migration_banco_da_caderneta_vitrine_antiga_sem_escrita_anonima_test.ts.
-- Como aplicar: docs/runbooks/estado-de-vida-da-loja.md, seção "O banco da caderneta: a vitrine antiga sem escrita anônima".
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_vitrine_antiga$
DECLARE
  v_view oid := to_regclass('public.vw_produtos_public');
  v_dono name;
  v_acl text;
BEGIN
  -- Antes de tudo: o banco certo. A ACL não separa o dekxab de uma loja atual (a "já aplicada" é a das lojas).
  IF to_regclass('public.frota_lojas') IS NULL OR to_regclass('public.frota_segredo') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: este banco não é o da caderneta (sem public.frota_lojas/frota_segredo) — script só para o banco da caderneta.';
  END IF;
  -- As tabelas existem também nas lojas (a 20261141 vai a cada canal), mas lá ficam vazias: só a caderneta de
  -- produção tem segredo e lojas. Só se pergunta SE há linha (EXISTS); nenhum conteúdo é lido.
  IF NOT EXISTS (SELECT 1 FROM public.frota_segredo) OR NOT EXISTS (SELECT 1 FROM public.frota_lojas) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a caderneta deste banco está vazia (sem segredo ou sem loja) — não é o banco onde a caderneta de produção mora; script só para ele.';
  END IF;
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: os papéis anon, authenticated e service_role têm de existir (banco do Supabase) — meça o banco.';
  END IF;
  IF v_view IS NULL OR (SELECT c.relkind FROM pg_class c WHERE c.oid = v_view) IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.vw_produtos_public não existe ou não é view — banco errado? meça o banco.';
  END IF;
  SELECT pg_get_userbyid(c.relowner), c.relacl::text INTO v_dono, v_acl FROM pg_class c WHERE c.oid = v_view;
  IF v_dono IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o dono de public.vw_produtos_public é %, não postgres — meça o banco.', v_dono;
  END IF;
  IF NOT (pg_has_role(current_user, 'postgres', 'MEMBER')
          OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = current_user AND r.rolsuper)) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não age como o dono da view (postgres) — aplique como postgres.', current_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_view AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.vw_produtos_public tem privilégio de coluna — o rollback não o devolveria; meça o banco.';
  END IF;
  IF v_acl IS DISTINCT FROM '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}'
     AND v_acl IS DISTINCT FROM '{postgres=arwdDxtm/postgres,anon=rx/postgres,authenticated=rx/postgres,service_role=arwdDxtm/postgres}' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a ACL viva de public.vw_produtos_public é % — nem a medida em 26/11 nem a já aplicada; o rollback não a reproduziria. Meça o banco.', v_acl;
  END IF;
END $preflight_vitrine_antiga$;

-- A única escrita: anon e authenticated deixam de escrever e de manter a view (SELECT e REFERENCES ficam, como nas lojas).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN ON public.vw_produtos_public FROM anon, authenticated;

DO $posvoo_vitrine_antiga$
DECLARE
  v_view oid := to_regclass('public.vw_produtos_public');
BEGIN
  IF (SELECT c.relacl::text FROM pg_class c WHERE c.oid = v_view)
     IS DISTINCT FROM '{postgres=arwdDxtm/postgres,anon=rx/postgres,authenticated=rx/postgres,service_role=arwdDxtm/postgres}' THEN
    RAISE EXCEPTION 'POSVOO_VITRINE_ANTIGA: a ACL de public.vw_produtos_public não ficou a esperada (%)',
      (SELECT c.relacl::text FROM pg_class c WHERE c.oid = v_view);
  END IF;
  IF has_table_privilege('anon', v_view, 'INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN')
     OR has_table_privilege('authenticated', v_view, 'INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, MAINTAIN')
     OR has_any_column_privilege('anon', v_view, 'INSERT, UPDATE')
     OR has_any_column_privilege('authenticated', v_view, 'INSERT, UPDATE') THEN
    RAISE EXCEPTION 'POSVOO_VITRINE_ANTIGA: anon ou authenticated ainda escreve ou mantém public.vw_produtos_public';
  END IF;
  IF NOT has_table_privilege('anon', v_view, 'SELECT') OR NOT has_table_privilege('authenticated', v_view, 'SELECT') THEN
    RAISE EXCEPTION 'POSVOO_VITRINE_ANTIGA: anon ou authenticated perdeu a leitura de public.vw_produtos_public';
  END IF;
END $posvoo_vitrine_antiga$;

-- Privilégio mudou: recarrega o schema cache do PostgREST. Idempotente.
NOTIFY pgrst, 'reload schema';
