-- ============================================================================
-- Migration 20261223000000 — o voto "útil" só vale em avaliação que o público vê
-- (permissão; decisão do dono, Gabriel, 14/10/2026: "fecha os dois"; a outra metade,
-- a moderação de perguntas, foi medida e NÃO é defeito, então este é o único lote)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- `public.increment_helpful(review_id uuid)` registra o voto "útil" de quem está logado
-- (a memória do voto é a tabela `review_votes`, `UNIQUE (review_id, user_id)`, da
-- 20261050000000). O corpo NÃO conferia o `status` da avaliação: uma conta logada que
-- soubesse o id votava "útil" numa avaliação AINDA PENDENTE de moderação, e o contador
-- `helpful` dela subia antes de qualquer pessoa vê-la. A função é SECURITY DEFINER (roda
-- com os direitos do dono, por cima da RLS de `reviews`), então a política de leitura da
-- tabela não a protegia.
--
-- 2. O QUE MUDA
--
-- SÓ o corpo: `CREATE OR REPLACE FUNCTION` com o MESMO corpo de antes (o da
-- 20261050000000, byte a byte) em que UM bloco é TROCADO, no mesmo lugar (logo depois da
-- checagem de login): a antiga checagem "avaliação inexistente = RETURN em silêncio"
-- (20261050000000, ~linha 89-96) sai, e entra a guarda nova no lugar dela:
--     IF NOT EXISTS (SELECT 1 FROM public.reviews WHERE id = v_review_id AND status = 'publicada') THEN
--       RAISE EXCEPTION 'Avaliação não encontrada.';
--     END IF;
-- A guarda nova cobre o que a antiga cobria (id que não existe) e mais (existe e não é
-- pública), então a antiga viraria código morto se ficasse empilhada embaixo dela; o
-- resto do corpo (login, INSERT ... ON CONFLICT, `IF NOT FOUND`, UPDATE do contador
-- `helpful`) não muda um byte.
-- Assinatura (`increment_helpful(review_id uuid)`; o PostgREST chama por NOME de argumento),
-- tipo de retorno (`void`), SECURITY DEFINER, `SET search_path TO 'public'` e VOLATILE ficam
-- iguais. A ACL NÃO é tocada: `CREATE OR REPLACE` preserva dono e privilégios; nenhum GRANT
-- nem REVOKE aqui (a ACL é da 20261221000000: PUBLIC não, anon não, authenticated sim,
-- service_role sim).
--
-- 3. QUAL É A CONDIÇÃO DE "AVALIAÇÃO QUE O PÚBLICO VÊ"
--
-- É `reviews.status = 'publicada'` — a MESMA que o público usa para VER a avaliação, sem
-- inventar outra:
--   * a vitrine do visitante, `public.vw_reviews_public`, filtra `WHERE r.status = 'publicada'`
--     (20261110000000, `CREATE VIEW`, ~linha 121-135);
--   * a policy de leitura direta da tabela, `reviews_select_policy` (20261111000000, ~linha
--     127-132), entrega a avaliação a quem não é dono nem admin SÓ quando
--     `status = 'publicada'`.
-- O CHECK `reviews_status_check` (20261031000000) só aceita `'publicada'` e `'pendente'`: a
-- "recusa" do painel é APAGAR a avaliação (não existe um status "recusada"), então uma avaliação
-- recusada é, para esta função, uma avaliação que NÃO EXISTE. Se um dia surgir um terceiro
-- status, a guarda é `= 'publicada'` (fecha por padrão), não `<> 'pendente'`.
--
-- 4. O QUE ACONTECE EM CADA CASO
--
--   * anon (visitante): sem EXECUTE desde a 20261221000000; o banco recusa com 42501 ANTES
--     do corpo. Nada muda.
--   * authenticated, avaliação PUBLICADA: o voto conta como antes (registra em
--     `review_votes` e soma 1 em `helpful`; o segundo voto do mesmo usuário continua sendo
--     no-op idempotente, sem exceção).
--   * authenticated, avaliação PENDENTE: exceção `Avaliação não encontrada.` (SQLSTATE
--     P0001); nada é gravado (nem em `review_votes`, nem em `helpful`). ESTA é a mudança.
--   * authenticated, id que NÃO EXISTE (inclui a avaliação recusada/apagada): a MESMA exceção,
--     com a MESMA mensagem — quem chama não descobre se o id existe. ISTO TAMBÉM MUDA: antes
--     era no-op silencioso (o acordo da 20261050000000, cabeçalho item 3 e linhas 89-96,
--     que `tests/migration_voto_util_tem_memoria_no_servidor_test.ts` ~116-119 fixa só para o
--     ARQUIVO daquela migration); agora é exceção, por dois motivos. (a) Um no-op para o
--     inexistente e uma exceção só para o pendente entregariam justamente a informação que a
--     guarda esconde (esse id existe e está pendente). (b) O no-op era uma mentira para a
--     tela: `markHelpful` (`useReviews.ts`, ~322-349) soma +1 de forma otimista e só desfaz se a
--     chamada devolver erro, então com o no-op a tela mostrava um "+1" que nunca foi gravado;
--     com o erro ela desfaz o +1 e diz a verdade (já testado em
--     `tests/front/voto-util-nao-conta-dois.test.tsx` ~150).
--   * O AUTOR votando na PRÓPRIA avaliação: a regra de antes não muda (o corpo nunca barrou
--     "voto no próprio"; esta migration não inventa essa regra). A avaliação PUBLICADA dele
--     recebe o voto como antes. A PENDENTE dele é recusada como a de qualquer pessoa: o autor a
--     VÊ (a policy dá a ele a própria avaliação), mas o PÚBLICO não, e o voto é um sinal ao
--     público.
--   * Admin: sem tratamento especial; o painel dele não vota. Uma pendente é recusada igual.
--   * Sem auth.uid() (authenticated sem sub, ou service_role): a exceção de login de antes
--     (`Acesso negado: usuário não autenticado.`) vem ANTES da guarda nova e segue igual.
--
-- 5. QUEM QUEBRA
--
-- O único chamador no app é `markHelpful` (`src/hooks/useReviews.ts`, ~linha 297), usado só
-- pelo card de avaliação da página do produto (`ProductView`). O erro cai no ramo que já
-- existia: o contador otimista volta, o `console.error` registra e o toast diz "Erro ao marcar
-- como útil." O caso visível: o autor tocar em "Útil" na própria avaliação ainda em análise —
-- um voto sem sentido, agora recusado (regressão de UX conhecida e aceita pelo dono; o front
-- não muda). Nenhuma edge function chama a RPC.
--
-- FORA DO ESCOPO (registrado, NÃO mexido aqui): a policy `review_votes_insert_policy`
-- (20261050000000, ~linha 66-69) deixa um logado gravar um voto direto na TABELA, inclusive
-- em avaliação pendente (isso não mexe no contador `helpful`, só grava a linha); e o card de
-- avaliação mostra "Útil" ao autor/admin na avaliação pendente (`ReviewCard.tsx`, ~164-181).
-- As duas são decisão de produto do dono.
--
-- 6. DADOS EXISTENTES
--
-- Nenhuma linha de `reviews` nem de `review_votes` é lida, reescrita ou apagada pelo apply (a
-- guarda só age quando alguém CHAMA a função). Os `helpful` acumulados e os votos já gravados
-- ficam como estão, inclusive os dados em avaliação pendente (se existirem, ninguém os apaga
-- aqui). Só uma função é redefinida.
--
-- 7. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de
-- `replace(prosrc, E'\r', '')`) não for UM dos dois conhecidos — o antigo (o da
-- 20261050000000) ou o novo (com a guarda); os atributos não forem os de sempre (plpgsql,
-- SECURITY DEFINER, VOLATILE, `search_path=public`, argumento `review_id uuid`, retorno `void`);
-- a tabela `review_votes`, a constraint `review_votes_um_voto_por_usuario` (o `ON CONFLICT ON
-- CONSTRAINT` do corpo), a coluna `reviews.status` (text NOT NULL) ou o CHECK
-- `reviews_status_check` que aceita 'publicada' não existirem, ou o dono da função não puder
-- ler `reviews` (a guarda quebraria o voto de todo mundo, e o PL/pgSQL só acusa coluna ou
-- constraint ausente na hora de EXECUTAR, não ao criar); ou a ACL não for EXATAMENTE a que a 20261221000000
-- deixa (PUBLIC não, anon não, authenticated sim, service_role sim). O corpo é identificado pelo
-- CONTEÚDO, não pelo nome. A loja que ainda não tem a 20261221000000 recusa aqui (a 24a tem de
-- estar POSITIVA antes).
--
-- 8. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Dois estados de entrada: corpo antigo (aplica) ou corpo novo (reaplicar reescreve o MESMO
-- texto: hash, ACL, dono e oid não mudam). Qualquer outro estado ABORTA. Sem BEGIN/COMMIT de
-- nível superior (regra da casa, AGENTS.md; `db-prove-rollback.cjs` recusa): quem abre a
-- transação é o aplicador (`aplicar-migrations.yml`/`db-apply.cjs`); o pré-voo, a troca do corpo
-- e a conferência final caem juntos ou não caem.
--
-- 9. ORDEM E ROLLBACK
--
-- Exige a 20261221000000 já aplicada (a ACL de depois dela). Nenhum front e nenhuma edge
-- function mudam: banco antes ou depois do front dá no mesmo. ROLLBACK MANUAL:
-- rollback-manual-20261223000000_o_voto_util_so_em_avaliacao_que_o_publico_ve.sql recria a
-- função com o corpo ANTIGO (o mesmo md5) sem tocar a ACL: com ele o voto volta a valer em
-- avaliação pendente e o id inexistente volta a ser no-op silencioso.
--
-- ATENÇÃO — a cadeia de rollbacks da 20261090500000
-- (`rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql`) NÃO deve rodar
-- depois desta migration: ela faz `GRANT EXECUTE ... TO PUBLIC` nesta função (e na
-- `get_reviews_metrics`) e reabriria a porta para TODOS, o visitante inclusive.
-- Ordem de desfazer, se for preciso: o rollback desta (23) vem ANTES do da 20261221.
--
-- PROVA VIVA: tests/banco/voto-util-so-em-avaliacao-publica-viva.cjs (comportamento por papel e por
-- status, rollback com o mesmo md5, pré-voo, conferência, idempotência, concorrência) e
-- tests/banco/voto-util-so-em-avaliacao-publica-portao-viva.cjs (consultas 26a e 26b).
-- ============================================================================

DO $preflight_20261223$
DECLARE
  v_fn CONSTANT text := 'public.increment_helpful(uuid)';
  v_oid oid := to_regprocedure('public.increment_helpful(uuid)');
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
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'increment_helpful') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: increment_helpful tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO: o antigo (sem a guarda de status) ou o novo (com ela).
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '25931ffa61160aa410e265f29c23532d' AND v_hash IS DISTINCT FROM '2f6144c15d7935f99386f848ac47fde1' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é nem o antigo (20261050000000, sem a guarda de status) nem o novo (com a guarda) — capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;

  -- Atributos que o CREATE OR REPLACE reescreve: têm de ser os de sempre.
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'review_id uuid'
          AND pg_get_function_result(p.oid) = 'void'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumento ou tipo de retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  -- A guarda lê `reviews.status`: sem a coluna (ou sem a tabela de votos, que o corpo já usa) o voto
  -- quebraria na hora de EXECUTAR, para todo mundo.
  IF to_regclass('public.review_votes') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.review_votes não existe — aplique a 20261050000000 antes.';
  END IF;
  -- O `ON CONFLICT ON CONSTRAINT` do corpo só falha na hora de EXECUTAR se a constraint não existir.
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint k
        WHERE k.conrelid = to_regclass('public.review_votes')
          AND k.conname = 'review_votes_um_voto_por_usuario'
          AND k.contype = 'u'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a constraint review_votes_um_voto_por_usuario não existe em public.review_votes — o voto quebraria na hora de executar; aplique a 20261050000000 antes.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint k
        WHERE k.conrelid = to_regclass('public.reviews')
          AND k.conname = 'reviews_status_check'
          AND k.contype = 'c'
          AND pg_get_constraintdef(k.oid) LIKE '%''publicada''%'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o CHECK reviews_status_check que aceita ''publicada'' não existe em public.reviews — a guarda dependeria de um status que o banco não garante; aplique a 20261031000000 antes.';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = to_regclass('public.reviews')
          AND a.attname = 'status'
          AND a.atttypid = 'text'::regtype
          AND a.attnotnull
          AND NOT a.attisdropped
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.reviews.status (text NOT NULL) não existe — aplique a 20261031000000 antes.';
  END IF;
  IF NOT has_table_privilege((SELECT proowner FROM pg_proc WHERE oid = v_oid), to_regclass('public.reviews'), 'SELECT') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o dono de % não lê public.reviews — a guarda nova quebraria a função.', v_fn;
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
END $preflight_20261223$;

CREATE OR REPLACE FUNCTION public.increment_helpful(review_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    -- A assinatura precisa continuar se chamando `review_id` (o PostgREST
    -- chama a RPC por NOME de argumento). Dentro do corpo, o v_ carrega o
    -- valor: na INSERT, o nome `review_id` é coluna da tabela-alvo e do
    -- parâmetro ao mesmo tempo — sem o v_, o PL/pgSQL trava com
    -- "column reference is ambiguous".
    v_review_id uuid := review_id;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
    END IF;

    -- Só avaliação que o PÚBLICO VÊ recebe voto: a mesma condição da vitrine
    -- (`vw_reviews_public`) e da policy `reviews_select_policy`, `status = 'publicada'`.
    -- Avaliação pendente e id que não existe levantam a MESMA exceção, com a mesma
    -- mensagem: quem chama não descobre se o id existe. Este bloco ocupa o lugar da
    -- antiga checagem "inexistente = não faz nada em silêncio" (20261050000000): a tela
    -- mostrava um +1 que nunca foi gravado; com o erro ela desfaz o +1 e diz a verdade.
    -- Como a guarda vem antes do INSERT, o id inexistente também nunca chega à FK.
    IF NOT EXISTS (
        SELECT 1 FROM public.reviews
         WHERE id = v_review_id AND status = 'publicada'
    ) THEN
        RAISE EXCEPTION 'Avaliação não encontrada.';
    END IF;

    -- O voto vira REGISTRO antes de virar número: a UNIQUE (review_id,
    -- user_id) é a deduplicação inteira. Segunda chamada do mesmo usuário
    -- insere zero linhas (FOUND = false) e o contador NÃO anda.
    -- A inferência é PELO NOME DA CONSTRAINT, não pelas colunas: o parâmetro
    -- da função se chama `review_id` (o PostgREST chama a RPC por nome de
    -- argumento e o nome não pode mudar), e `ON CONFLICT (review_id, ...)`
    -- colidiria com ele — PL/pgSQL trava com "column reference is
    -- ambiguous". O nome da constraint não colide com nada.
    INSERT INTO public.review_votes (review_id, user_id)
    VALUES (v_review_id, auth.uid())
    ON CONFLICT ON CONSTRAINT review_votes_um_voto_por_usuario DO NOTHING;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE public.reviews
       SET helpful = COALESCE(helpful, 0) + 1
     WHERE id = v_review_id;
END;
$function$;

-- CONFERÊNCIA no instante do apply: aborta se o corpo vivo não é o novo, se algum atributo
-- mudou, ou se a ACL não ficou PUBLIC não, anon não, authenticated sim, service_role sim.
DO $conferencia_20261223$
DECLARE
  v_fn CONSTANT text := 'public.increment_helpful(uuid)';
  v_oid oid := to_regprocedure('public.increment_helpful(uuid)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261223: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'increment_helpful') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261223: increment_helpful ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '2f6144c15d7935f99386f848ac47fde1' THEN
    RAISE EXCEPTION 'conferencia 20261223: corpo vivo de % (hash %) não é o novo, com a guarda de status', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'review_id uuid'
          AND pg_get_function_result(p.oid) = 'void'
     ) THEN
    RAISE EXCEPTION 'conferencia 20261223: atributos de % mudaram (SECURITY DEFINER, volatilidade, search_path, argumento ou tipo de retorno)', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261223: % alcancavel por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261223: anon executa %', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261223: authenticated perdeu EXECUTE em %', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261223: service_role perdeu EXECUTE em %', v_fn;
  END IF;
END $conferencia_20261223$;
