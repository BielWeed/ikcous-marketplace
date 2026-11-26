-- ============================================================================
-- Migration 20261480000000 — a caderneta fecha para o service_role (plano L8, 26/11/2026; caderneta da frota)
-- ============================================================================
--
-- 1. O QUE FALTAVA
--
-- public.frota_lojas guarda o endereço (supabase_url) e a chave publicável do banco de CADA loja da frota; public.frota_segredo guarda o
-- hash da chave que abre a caderneta. A 20261141 fechou as duas para PUBLIC, anon e authenticated, mas NÃO para o service_role: o ALTER
-- DEFAULT PRIVILEGES do schema public (ver o cabeçalho da 20261141, itens 1 e 2) deu a ele todos os privilégios de tabela (arwdDxtm) e
-- ninguém revogou. Quem tiver a chave service_role do banco da caderneta lê a frota inteira e troca o endereço de qualquer loja pela API.
-- Medido no efêmero (provisionar.cjs reproduz o default privilege), depois de todas as migrations até a 20261470:
--   frota_lojas.relacl = frota_segredo.relacl = {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}.
-- NADA no repositório lê ou escreve essas tabelas como service_role (mapeado em 26/11/2026): o porteiro (middleware.ts,
-- src/hospedagem/porteiro.ts) só chama /rest/v1/rpc/resolver_loja_com_estado e /rest/v1/rpc/resolver_loja (SECURITY DEFINER: leem como o
-- dono; EXECUTE só do anon); nenhuma edge function cita a caderneta; scripts/frota/estado-da-loja.mjs, os runbooks e o MCP usam o dono
-- (postgres); as provas usam o dono; as consultas do portão leem só catálogo com supabase_read_only_user.
--
-- 2. O QUE ESTA MIGRATION FAZ (no banco que guarda a caderneta; nas outras lojas as duas tabelas existem vazias e o efeito é o mesmo)
--
--   REVOKE ALL ON TABLE public.frota_lojas, public.frota_segredo FROM service_role — e nada mais. Tira também qualquer privilégio de
--   coluna do service_role (o REVOKE de tabela leva os de coluna junto). PUBLIC, anon e authenticated continuam sem nada; o dono continua
--   com tudo; as portas resolver_loja e resolver_loja_com_estado continuam executáveis só pelo anon e lendo como o dono (o porteiro não
--   sente nada). O service_role do Supabase tem BYPASSRLS, mas BYPASSRLS não dá privilégio de tabela: sem GRANT, SELECT/INSERT/UPDATE/
--   DELETE nas duas recebem 42501.
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha é lida, escrita, apagada ou reescrita (nenhum INSERT, UPDATE, DELETE nem SELECT nas tabelas: o pré-voo e o pós-voo leem
-- só o catálogo). Muda só a ACL das duas tabelas (pg_class.relacl), na entrada do service_role. Aplicar duas vezes deixa o mesmo estado:
-- revogar o já revogado é no-op e o pré-voo aceita o service_role sem nada.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: os papéis service_role ou anon não existem; frota_lojas ou frota_segredo não existem; a 20261460000000 não está no estado do
-- repositório (resolver_loja e resolver_loja_com_estado com os corpos dela, md5 19072d99f3253583342a0bb6c42447dd e
-- 92682af1143806d3662411b6d5788096, os mesmos que o pré-voo da 20261470 confere); o dono das duas portas não é o dono das duas tabelas
-- (a porta SECURITY DEFINER lê como o dono dela: com outro dono ela poderia depender justamente do privilégio que sai aqui); o
-- service_role tem, em alguma das duas, só PARTE dos privilégios de tabela, privilégio concedido por outro que não o dono, GRANT OPTION ou
-- privilégio de coluna; ou as duas tabelas estão em estados diferentes (uma com tudo, a outra sem nada). Nesses casos o rollback
-- (GRANT ALL) não reproduziria o estado vivo, e o banco tem de ser medido antes. Aceita: as duas com TUDO (o conjunto de privilégios do
-- dono, concedido pelo dono, sem GRANT OPTION — o estado de hoje) ou as duas SEM NADA (reaplicação).
--
-- 5. TRANSAÇÃO E TRAVAS
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa): quem abre a transação é o aplicador; pré-voo, REVOKE e pós-voo caem juntos ou não
-- caem. GRANT/REVOKE não pede trava de tabela (medido no PG 17: passa com ACCESS EXCLUSIVE de outra sessão segurando frota_lojas, e o
-- porteiro lendo não espera nada); só espera outra transação que esteja ALTERANDO a definição da mesma tabela (a linha dela em pg_class).
-- lock_timeout de 5 s: se esperar mais que isso, a migration desiste sem escrever nada (rodar de novo).
--
-- 6. ORDEM E ROLLBACK
--
-- Depois da 20261460000000 (o pré-voo recusa sem ela); independe da 20261470000000. Aplicar em CADA banco do canal (IKCOUS e Savy) e no
-- banco onde a caderneta de produção mora (IKCOUS_FROTA_URL, hoje o dekxab, pelo MCP). Consultas da publicação: 184b antes, 184a depois.
-- ROLLBACK MANUAL: rollback-manual-20261480000000_a_caderneta_fecha_para_o_service_role.sql devolve GRANT ALL ... TO service_role (o
-- estado de antes, byte a byte na ACL quando aplicado pelo dono ou por superusuário). Não há rollback destrutivo: nada é criado.
--
-- 7. FICHA DE VERIFICAÇÃO
--
--   1. SELECT c.relname, c.relacl FROM pg_class c WHERE c.oid IN ('public.frota_lojas'::regclass, 'public.frota_segredo'::regclass);
--      -- esperado: nenhuma entrada service_role=... nas duas.
--   2. SELECT has_table_privilege('service_role', 'public.frota_lojas', 'SELECT'), has_table_privilege('service_role', 'public.frota_segredo', 'SELECT'),
--             has_function_privilege('anon', 'public.resolver_loja_com_estado(text, text)', 'EXECUTE');
--      -- esperado: false, false, true.
--   PROVA VIVA: tests/banco/a-caderneta-fecha-para-o-service-role-viva.cjs (rpc-ci); portão da release: consultas 184a e 184b.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261480000000$
DECLARE
  v_lojas oid := to_regclass('public.frota_lojas');
  v_segredo oid := to_regclass('public.frota_segredo');
  v_v1 oid := to_regprocedure('public.resolver_loja(text, text)');
  v_v2 oid := to_regprocedure('public.resolver_loja_com_estado(text, text)');
  v_sr oid := to_regrole('service_role');
  v_estados text;
BEGIN
  IF v_sr IS NULL OR to_regrole('anon') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: os papéis service_role e anon têm de existir (banco do Supabase) — meça o banco.';
  END IF;
  IF v_lojas IS NULL OR v_segredo IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.frota_lojas ou public.frota_segredo não existe — aplique a 20261141000000 e a 20261460000000 antes.';
  END IF;
  -- A 20261460000000 no estado do repositório: as duas portas da caderneta com os corpos dela (os md5 que a 20261470 também confere).
  IF (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = v_v1) IS DISTINCT FROM '19072d99f3253583342a0bb6c42447dd'
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = v_v2) IS DISTINCT FROM '92682af1143806d3662411b6d5788096' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a 20261460000000 não está aplicada como esperado (resolver_loja e resolver_loja_com_estado com os corpos dela) — aplique-a antes ou meça o banco.';
  END IF;
  -- A porta SECURITY DEFINER lê a caderneta como o dono dela: o dono das duas portas tem de ser o dono das duas tabelas.
  IF (SELECT count(DISTINCT d) FROM (
        SELECT p.proowner AS d FROM pg_proc p WHERE p.oid IN (v_v1, v_v2)
        UNION ALL SELECT c.relowner FROM pg_class c WHERE c.oid IN (v_lojas, v_segredo)) x) <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o dono de frota_lojas, frota_segredo, resolver_loja e resolver_loja_com_estado não é o mesmo — meça o banco e revise.';
  END IF;

  -- service_role em cada tabela: 'tudo' (o conjunto do dono, concedido pelo dono, sem GRANT OPTION, nada de coluna), 'nada', ou outro.
  SELECT string_agg(t.estado, ',' ORDER BY t.relname) INTO v_estados FROM (
    SELECT c.relname,
           CASE
             WHEN EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) g
                           WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL AND g.grantee = v_sr) THEN 'coluna'
             WHEN NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE g.grantee = v_sr) THEN 'nada'
             WHEN (SELECT string_agg(g.privilege_type || CASE WHEN g.grantor = c.relowner THEN '' ELSE '/outro' END
                                     || CASE WHEN g.is_grantable THEN '*' ELSE '' END, ',' ORDER BY g.privilege_type)
                     FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE g.grantee = v_sr)
                  = (SELECT string_agg(g.privilege_type, ',' ORDER BY g.privilege_type)
                       FROM aclexplode(acldefault('r', c.relowner)) g WHERE g.grantee = c.relowner) THEN 'tudo'
             ELSE 'parte'
           END AS estado
      FROM pg_class c WHERE c.oid IN (v_lojas, v_segredo)) t;
  IF v_estados NOT IN ('tudo,tudo', 'nada,nada') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o service_role em frota_lojas,frota_segredo está %, e esta migration só aceita as duas com TUDO (o conjunto do dono, concedido pelo dono, sem GRANT OPTION, sem privilégio de coluna) ou as duas sem NADA — o rollback não reproduziria esse estado; meça o banco e revise.', v_estados;
  END IF;

  -- Fotografia do que esta migration não pode mudar: as duas tabelas (menos a entrada do service_role na ACL), colunas, restrições,
  -- políticas, gatilhos e as duas portas da caderneta.
  PERFORM set_config('ikcous.cofre1480_base', (
    SELECT jsonb_build_object(
      'tabelas', (SELECT jsonb_agg(to_jsonb(c) - 'relacl' - 'reltuples' - 'relpages' - 'relallvisible' ORDER BY c.relname)
                    FROM pg_class c WHERE c.oid IN (v_lojas, v_segredo)),
      'acl_sem_service_role', (SELECT jsonb_agg(jsonb_build_array(c.relname, g.grantor, g.grantee, g.privilege_type, g.is_grantable)
                                                ORDER BY c.relname, g.grantee, g.privilege_type)
                                 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                                WHERE c.oid IN (v_lojas, v_segredo) AND g.grantee <> v_sr),
      'colunas', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid, a.attnum) FROM pg_attribute a
                   WHERE a.attrelid IN (v_lojas, v_segredo) AND a.attnum > 0),
      'restricoes', (SELECT jsonb_agg(k.conname || '=' || pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k
                      WHERE k.conrelid IN (v_lojas, v_segredo)),
      'politicas', (SELECT count(*) FROM pg_policy p WHERE p.polrelid IN (v_lojas, v_segredo)),
      'gatilhos', (SELECT jsonb_agg(jsonb_build_array(t.tgname, t.tgfoid, t.tgtype, t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t
                    WHERE t.tgrelid IN (v_lojas, v_segredo)),
      'portas', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.proname) FROM pg_proc p WHERE p.oid IN (v_v1, v_v2))))::text, true);
END $preflight_20261480000000$;

-- A única escrita: o service_role deixa de alcançar a caderneta. Revogar o já revogado é no-op.
REVOKE ALL ON TABLE public.frota_lojas, public.frota_segredo FROM service_role;

DO $posvoo_20261480000000$
DECLARE
  v_lojas oid := to_regclass('public.frota_lojas');
  v_segredo oid := to_regclass('public.frota_segredo');
  v_v1 oid := to_regprocedure('public.resolver_loja(text, text)');
  v_v2 oid := to_regprocedure('public.resolver_loja_com_estado(text, text)');
  v_sr oid := to_regrole('service_role');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN (v_lojas, v_segredo)
               AND (EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE g.grantee = v_sr)
                    OR EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) g
                                WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL AND g.grantee = v_sr)
                    OR has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                    OR has_any_column_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))) THEN
    RAISE EXCEPTION 'POSVOO_20261480000000: o service_role ainda tem privilégio em frota_lojas ou frota_segredo';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid IN (v_lojas, v_segredo)
               AND (EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE g.grantee = 0)
                    OR has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                    OR has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                    OR has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
                    OR has_any_column_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))) THEN
    RAISE EXCEPTION 'POSVOO_20261480000000: PUBLIC, anon ou authenticated alcança frota_lojas ou frota_segredo';
  END IF;
  IF NOT has_function_privilege('anon', v_v1, 'EXECUTE') OR NOT has_function_privilege('anon', v_v2, 'EXECUTE')
     OR has_function_privilege('service_role', v_v1, 'EXECUTE') OR has_function_privilege('service_role', v_v2, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261480000000: as portas do porteiro (resolver_loja e resolver_loja_com_estado) não são mais só do anon';
  END IF;
  IF (SELECT jsonb_build_object(
        'tabelas', (SELECT jsonb_agg(to_jsonb(c) - 'relacl' - 'reltuples' - 'relpages' - 'relallvisible' ORDER BY c.relname)
                      FROM pg_class c WHERE c.oid IN (v_lojas, v_segredo)),
        'acl_sem_service_role', (SELECT jsonb_agg(jsonb_build_array(c.relname, g.grantor, g.grantee, g.privilege_type, g.is_grantable)
                                                  ORDER BY c.relname, g.grantee, g.privilege_type)
                                   FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                                  WHERE c.oid IN (v_lojas, v_segredo) AND g.grantee <> v_sr),
        'colunas', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid, a.attnum) FROM pg_attribute a
                     WHERE a.attrelid IN (v_lojas, v_segredo) AND a.attnum > 0),
        'restricoes', (SELECT jsonb_agg(k.conname || '=' || pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k
                        WHERE k.conrelid IN (v_lojas, v_segredo)),
        'politicas', (SELECT count(*) FROM pg_policy p WHERE p.polrelid IN (v_lojas, v_segredo)),
        'gatilhos', (SELECT jsonb_agg(jsonb_build_array(t.tgname, t.tgfoid, t.tgtype, t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t
                      WHERE t.tgrelid IN (v_lojas, v_segredo)),
        'portas', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.proname) FROM pg_proc p WHERE p.oid IN (v_v1, v_v2))))
     IS DISTINCT FROM current_setting('ikcous.cofre1480_base')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_20261480000000: algo além da entrada do service_role mudou em frota_lojas, frota_segredo ou nas portas da caderneta';
  END IF;
END $posvoo_20261480000000$;

-- Privilégio mudou: recarrega o schema cache do PostgREST (que esconde o que o papel não alcança). Idempotente.
NOTIFY pgrst, 'reload schema';
