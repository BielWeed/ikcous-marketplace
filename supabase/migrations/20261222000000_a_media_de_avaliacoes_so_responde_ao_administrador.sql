-- ============================================================================
-- Migration 20261222000000 — a média de avaliações só responde ao administrador
-- (permissão; ordem do dono, 14/10/2026: "exige admin na média de avaliações";
-- é o follow-up registrado na migration 20261221000000, seção 8)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- `public.get_reviews_metrics(p_search text, p_rating integer)` devolve a média, o
-- total de avaliações "verificadas" e o total de avaliações respondidas pelo lojista.
-- É SECURITY DEFINER (lê `reviews` com os direitos do dono, por cima da RLS) e o corpo
-- NÃO checava quem chama: qualquer conta LOGADA (authenticated, a conta de um
-- cliente comum) lia a média e as contagens de TODAS as avaliações, as pendentes de
-- moderação incluídas, e o `p_search` fazia ILIKE em nomes de perfis públicos e de
-- produtos. A 20261221000000 já tirou o visitante sem login; esta tira o cliente logado.
-- Só o painel de avaliações do lojista a usa.
--
-- 2. O QUE MUDA
--
-- SÓ o corpo: `CREATE OR REPLACE FUNCTION` com o MESMO corpo de antes (o da baseline
-- 20260806000000, byte a byte) e UMA guarda nova na primeira instrução, a mesma da irmã
-- `get_admin_reviews_paged` (20261002000000):
--     IF NOT public.is_admin() THEN
--       RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
--     END IF;
-- Assinatura, nomes e padrões dos argumentos, tipo de retorno, SECURITY DEFINER,
-- `SET search_path TO 'public'` e VOLATILE ficam iguais (a lista L8 reprova se o tipo
-- ou o SECURITY DEFINER mudarem; nada de STABLE). A ACL não é tocada:
-- `CREATE OR REPLACE` preserva dono e privilégios; nenhum GRANT nem REVOKE aqui.
--
-- 3. O QUE `is_admin()` FAZ EM CADA PAPEL (baseline 20260806000000, ~3094)
--
-- `is_admin()` devolve verdadeiro se: (a) o papel da sessão (GUC `role`) é `postgres` ou
-- `service_role`; ou (b) o JWT tem `app_metadata.role = 'admin'`; ou (c) `auth.users`
-- tem `raw_app_meta_data.role = 'admin'` para `auth.uid()`. Em cada porta:
--   * anon (visitante): sem EXECUTE desde a 20261221000000; o banco recusa com 42501
--     ANTES do corpo. Nada muda.
--   * authenticated NÃO-admin (cliente, gerente, vendedor): chega ao corpo e a guarda
--     levanta a exceção acima (SQLSTATE P0001). ESTA é a mudança.
--   * authenticated ADMIN: devolve a MESMA linha de antes.
--   * service_role (chave de serviço do PostgREST põe o GUC `role` em service_role):
--     a guarda passa e devolve a linha. Hoje ninguém chama a função como service_role.
--   * sessão direta `postgres` SEM `SET ROLE`: o GUC `role` vale 'none', não 'postgres';
--     sem JWT e sem auth.uid() a guarda NEGA. Ninguém chama a função assim (nenhuma
--     view, política, gatilho ou outra função a chama; o levantamento é o da
--     20261221000000); para conferir à mão, use `SET ROLE service_role` ou um JWT.
-- Usa-se `is_admin()` e não `is_admin_atual()`: é a mesma regra do portão do painel
-- (o front espelha `is_admin()` por RPC) e da irmã `get_admin_reviews_paged`.
-- CONSEQUÊNCIA ACEITA: um admin rebaixado continua lendo esta média até o JWT dele
-- vencer (a fonte (b) vale até a expiração do token). É média e contagem, não dinheiro;
-- as RPCs de dinheiro usam `is_admin_atual()` justamente por isso.
--
-- 4. QUEM QUEBRA
--
-- Só uma conta logada que NÃO seja admin e chame a função. O único chamador no app é o
-- ramo "não-admin" de `getAllReviews` (`src/hooks/useReviews.ts`, ~linha 511); o admin
-- já usa `get_admin_reviews_paged`. O painel de avaliações só abre para admin (o front
-- só marca `isAdmin` quando a RPC `is_admin` do servidor diz que sim). Se um não-admin
-- chegasse a esse ramo, o erro cai em `metricsError`, que o código só registra no
-- console (`console.error`): a média fica 0 e a tela segue; nada quebra pior do que hoje.
--
-- 5. DADOS EXISTENTES
--
-- Nenhuma linha de `reviews` nem de qualquer tabela é lida, reescrita ou apagada pelo
-- apply (a guarda só age quando alguém CHAMA a função). Só uma função é redefinida.
--
-- 6. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de
-- `replace(prosrc, E'\r', '')`) não for UM dos dois conhecidos — o antigo, sem guarda
-- (o da baseline), ou o novo, com guarda; os atributos não forem os de sempre
-- (SECURITY DEFINER, plpgsql, VOLATILE, `search_path=public`, argumentos e tipo de
-- retorno); `is_admin()` não existir ou o dono da função não puder executá-la (sem ela
-- a guarda quebraria o painel do admin); ou a ACL não for EXATAMENTE a que a
-- 20261221000000 deixa (PUBLIC não, anon não, authenticated sim, service_role sim). O
-- corpo é identificado pelo CONTEÚDO, não pelo nome. A loja que ainda não tem a
-- 20261221000000 recusa aqui, com a mensagem pedindo para aplicá-la antes (a 24a tem de
-- estar POSITIVA).
--
-- 7. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Dois estados de entrada: corpo antigo (aplica) ou corpo novo (reaplicar reescreve o
-- MESMO texto: o hash, a ACL, o dono e o oid da função não mudam; medido na prova viva).
-- Qualquer outro estado ABORTA. Sem BEGIN/COMMIT de nível superior (regra da casa,
-- AGENTS.md; `db-prove-rollback.cjs` recusa): quem abre a transação é o aplicador
-- (`aplicar-migrations.yml`/`db-apply.cjs`); o pré-voo, a troca do corpo e a conferência
-- final caem juntos ou não caem.
--
-- 8. ORDEM E ROLLBACK
--
-- Exige a 20261221000000 já aplicada (a ACL de depois dela). Nenhum front e nenhuma edge
-- function mudam: banco antes ou depois do front dá no mesmo, porque o app só chama a
-- função no painel do admin. ROLLBACK MANUAL:
-- rollback-manual-20261222000000_a_media_de_avaliacoes_so_responde_ao_administrador.sql
-- recria a função com o corpo ANTIGO (o mesmo md5) sem tocar a ACL: com ele a média
-- volta a responder a qualquer conta logada.
--
-- ATENÇÃO — a cadeia de rollbacks da 20261090500000
-- (`rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql`) NÃO
-- deve rodar depois desta migration: ela faz `GRANT EXECUTE ... TO PUBLIC` nesta função
-- (e na `increment_helpful`) e reabriria a porta para TODOS, o visitante inclusive;
-- sem a guarda no corpo, entregaria a média de todas as avaliações a qualquer um.
-- Ordem de desfazer, se for preciso: o rollback desta (22) vem ANTES do da 20261221.
--
-- PROVA VIVA: tests/banco/media-de-avaliacoes-so-admin-viva.cjs (comportamento por papel,
-- rollback com o mesmo md5, pré-voo, conferência, idempotência, concorrência) e
-- tests/banco/media-de-avaliacoes-so-admin-portao-viva.cjs (consultas 25a e 25b).
-- ============================================================================

DO $preflight_20261222$
DECLARE
  v_fn CONSTANT text := 'public.get_reviews_metrics(text,integer)';
  v_oid oid := to_regprocedure('public.get_reviews_metrics(text,integer)');
  v_hash text;
  v_public boolean;
  v_anon boolean;
  v_auth boolean;
  v_servico boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_reviews_metrics') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_reviews_metrics tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO: o antigo (sem guarda) ou o novo (com guarda).
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'f7fb638c20dce1ae26509f4ffc563120' AND v_hash IS DISTINCT FROM 'cb41947ab5a8075cea87ab123913b10d' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é nem o antigo (sem guarda) nem o novo (com guarda) — capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;

  -- Atributos que o CREATE OR REPLACE reescreve: têm de ser os de sempre.
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer'
          AND pg_get_function_result(p.oid) = 'TABLE(average_rating numeric, total_verified bigint, total_replied bigint)'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou tipo de retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  -- A guarda chama is_admin(): sem ela de pé (e executável pelo dono desta função, que é
  -- quem a chama por ser SECURITY DEFINER) o painel do admin deixaria de abrir.
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.is_admin() não existe — a guarda nova dependeria dela.';
  END IF;
  IF NOT has_function_privilege((SELECT proowner FROM pg_proc WHERE oid = v_oid), to_regprocedure('public.is_admin()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o dono de % não executa public.is_admin() — a guarda nova quebraria a função.', v_fn;
  END IF;

  -- ACL exatamente a que a 20261221000000 deixa (PUBLIC medido por aclexplode, grantee = 0).
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
  v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  v_servico := has_function_privilege('service_role', v_oid, 'EXECUTE');
  IF NOT (NOT v_public AND NOT v_anon AND v_auth AND v_servico) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a que a 20261221000000 deixa (PUBLIC=%, anon=%, authenticated=%, service_role=%) — aplique a 20261221000000 antes (a 24a tem de estar positiva) ou meça a loja e revise.', v_fn, v_public, v_anon, v_auth, v_servico;
  END IF;
END $preflight_20261222$;

CREATE OR REPLACE FUNCTION public.get_reviews_metrics(p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer)
 RETURNS TABLE(average_rating numeric, total_verified bigint, total_replied bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_search_pattern text;
  v_profile_ids uuid[];
  v_product_ids uuid[];
BEGIN
  -- Só o administrador lê a média e as contagens de TODAS as avaliações (as pendentes
  -- entram na conta). Mesma guarda da irmã get_admin_reviews_paged.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
  END IF;

  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_search_pattern := '%' || p_search || '%';
    
    SELECT COALESCE(array_agg(id), '{}') INTO v_profile_ids 
    FROM public_profiles 
    WHERE full_name ILIKE v_search_pattern;
    
    SELECT COALESCE(array_agg(id), '{}') INTO v_product_ids 
    FROM produtos 
    WHERE nome ILIKE v_search_pattern;
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(AVG(r.rating), 0.0)::numeric as average_rating,
    COUNT(CASE WHEN r.verified = true THEN 1 END)::bigint as total_verified,
    COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)::bigint as total_replied
  FROM reviews r
  WHERE 
    (p_rating IS NULL OR r.rating = p_rating)
    AND (
      p_search IS NULL OR p_search = '' 
      OR r.comment ILIKE v_search_pattern
      OR (v_profile_ids IS NOT NULL AND r.user_id = ANY(v_profile_ids))
      OR (v_product_ids IS NOT NULL AND r.product_id = ANY(v_product_ids))
    );
END;
$$;

-- CONFERÊNCIA no instante do apply: aborta se o corpo vivo não é o novo, se algum atributo
-- mudou, ou se a ACL não ficou PUBLIC não, anon não, authenticated sim, service_role sim.
DO $conferencia_20261222$
DECLARE
  v_fn CONSTANT text := 'public.get_reviews_metrics(text,integer)';
  v_oid oid := to_regprocedure('public.get_reviews_metrics(text,integer)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261222: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_reviews_metrics') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261222: get_reviews_metrics ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'cb41947ab5a8075cea87ab123913b10d' THEN
    RAISE EXCEPTION 'conferencia 20261222: corpo vivo de % (hash %) não é o novo, com a guarda de admin', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer'
          AND pg_get_function_result(p.oid) = 'TABLE(average_rating numeric, total_verified bigint, total_replied bigint)'
     ) THEN
    RAISE EXCEPTION 'conferencia 20261222: atributos de % mudaram (SECURITY DEFINER, volatilidade, search_path, argumentos ou tipo de retorno)', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261222: % alcancavel por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261222: anon executa %', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261222: authenticated perdeu EXECUTE em %', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261222: service_role perdeu EXECUTE em %', v_fn;
  END IF;
END $conferencia_20261222$;
