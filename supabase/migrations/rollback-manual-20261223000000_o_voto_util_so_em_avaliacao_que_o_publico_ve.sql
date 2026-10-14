-- ============================================================================
-- Rollback manual — o voto "útil" só vale em avaliação que o público vê
-- (20261223000000)
-- ============================================================================
-- Recria `increment_helpful(review_id uuid)` com o corpo ANTIGO, sem a guarda de status (o corpo da
-- 20261050000000, byte a byte: o md5 de `replace(prosrc, E'\r', '')` volta a ser o de antes, e a prova
-- viva confere). Assinatura, SECURITY DEFINER, `search_path`, volatilidade e tipo de retorno são os
-- mesmos da migration.
--
-- A ACL NÃO é tocada: `CREATE OR REPLACE` preserva dono e privilégios, e este arquivo não tem nenhum
-- GRANT nem REVOKE — nunca devolve EXECUTE a anon ou a PUBLIC. Se a 20261221000000 está aplicada, a
-- função continua fechada ao visitante.
--
-- COM ELE VOLTA O DEFEITO: uma conta logada volta a votar "útil" numa avaliação PENDENTE (o contador
-- sobe antes de qualquer pessoa vê-la), e o id inexistente volta a ser no-op silencioso.
--
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui.
--
-- PRÉ-VOO: recusa (`B1_BASELINE_DIVERGENT`) se a função não existir ou tiver sobrecarga; se o corpo vivo
-- não for um dos dois conhecidos (o novo, com guarda, ou o antigo, e então rodar de novo reescreve o
-- mesmo texto) — reescrever por cima de um corpo desconhecido apagaria uma redefinição que ninguém
-- revisou; se os atributos não forem os de sempre; ou se PUBLIC tiver EXECUTE ou authenticated/service_role
-- não tiverem (o estado de antes nunca teve PUBLIC). A conferência final recusa se o corpo não voltou ao
-- antigo, se algum atributo mudou ou se PUBLIC passou a executar.
--
-- ORDEM: este vem ANTES do rollback da 20261221000000, se os dois forem rodados.
-- ATENÇÃO — NÃO RODE depois deste arquivo o
-- `rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql`: ele faz
-- `GRANT EXECUTE ... TO PUBLIC` nesta função e a reabre para TODOS, inclusive o visitante, agora SEM a
-- guarda de status no corpo.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT
-- de nível superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

DO $preflight_rollback_20261223$
DECLARE
  v_fn CONSTANT text := 'public.increment_helpful(uuid)';
  v_oid oid := to_regprocedure('public.increment_helpful(uuid)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe — nada a devolver.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'increment_helpful') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: increment_helpful tem sobrecarga em public — revise antes de devolver o corpo antigo.';
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '25931ffa61160aa410e265f29c23532d' AND v_hash IS DISTINCT FROM '2f6144c15d7935f99386f848ac47fde1' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o novo (com guarda) nem o antigo — uma redefinição posterior está no ar; revise antes de sobrescrever.', v_fn, COALESCE(v_hash, 'ausente');
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
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos — revise antes de sobrescrever.', v_fn;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % está aberta para PUBLIC — o estado de antes nunca teve PUBLIC; revise a ACL antes.', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: authenticated ou service_role sem EXECUTE em % — revise a ACL antes.', v_fn;
  END IF;
END $preflight_rollback_20261223$;

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

    -- Avaliação inexistente: no-op silencioso, o MESMO contrato do corpo
    -- antigo (o UPDATE sem linha não fazia nada) — não deixa a FK violar
    -- onde antes não violava.
    IF NOT EXISTS (
        SELECT 1 FROM public.reviews WHERE id = v_review_id
    ) THEN
        RETURN;
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

DO $conferencia_rollback_20261223$
DECLARE
  v_fn CONSTANT text := 'public.increment_helpful(uuid)';
  v_oid oid := to_regprocedure('public.increment_helpful(uuid)');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '25931ffa61160aa410e265f29c23532d' THEN
    RAISE EXCEPTION 'conferencia rollback 20261223: corpo vivo de % (hash %) não voltou ao antigo', v_fn, COALESCE(v_hash, 'ausente');
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
    RAISE EXCEPTION 'conferencia rollback 20261223: atributos de % mudaram', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia rollback 20261223: % aberta para PUBLIC — o estado de antes não tinha PUBLIC', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261223: authenticated ou service_role sem EXECUTE em %', v_fn;
  END IF;
END $conferencia_rollback_20261223$;
