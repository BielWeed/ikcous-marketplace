-- ============================================================================
-- Rollback manual — desfazer o recebimento recusa pedido com devolução (20261243000000)
-- ============================================================================
-- Recria public.registrar_pagamento_recebido(uuid, boolean) com o corpo VIGENTE de antes (o da
-- 20261197000000, byte a byte: o md5 de replace(prosrc, E'\r', '') volta a ser 6584d62da7815a913b1e0cb86c108b0f, e a prova
-- viva confere). Assinatura, SECURITY DEFINER, VOLATILE, search_path = public e retorno são os
-- mesmos da migration.
--
-- A ACL e o comentário da função NÃO são tocados: CREATE OR REPLACE preserva dono, privilégios e
-- comentário, e este arquivo não tem nenhum GRANT, REVOKE nem COMMENT.
--
-- COM ELE VOLTA O DEFEITO: "Desfazer recebimento" volta a funcionar em pedido com devolução
-- aberta ou concluída, e a venda some do Financeiro enquanto a saída do reembolso fica.
--
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui. Recebimentos desfeitos
-- enquanto a migration valeu (sem devolução viva) FICAM como fatos.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se a função não existir ou tiver sobrecarga; se o corpo
-- vivo não for um dos dois conhecidos (o desta migration, ou o vigente — e então rodar de novo
-- reescreve o mesmo texto: idempotente); ou se os atributos não forem os de sempre. Uma
-- redefinição POSTERIOR no ar também recusa (nunca restaurar por baixo dela). A conferência final
-- recusa se o corpo não voltou ao vigente.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo
-- estado.
-- ============================================================================

DO $preflight_rollback_20261243$
DECLARE
  v_fn CONSTANT text := 'public.registrar_pagamento_recebido(uuid, boolean)';
  v_oid oid := to_regprocedure('public.registrar_pagamento_recebido(uuid, boolean)');
  v_hash text;
  r record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe — nada a devolver.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'registrar_pagamento_recebido') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: registrar_pagamento_recebido tem sobrecarga em public — revise antes de devolver o corpo vigente.';
  END IF;

  -- O corpo vivo tem de ser o desta migration (desfaz) ou o vigente (já desfeito: reescreve o mesmo texto).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.registrar_pagamento_recebido(uuid, boolean)', '6584d62da7815a913b1e0cb86c108b0f', '88270bb1e228c90be73acca03a3cee4e')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o desta migration nem o vigente — uma redefinição posterior está no ar; revise antes de sobrescrever.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proisstrict
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'jsonb'
          AND p.pronargs = 2
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, STRICT, search_path, retorno ou argumentos) não são os conhecidos — revise antes de devolver o corpo vigente.', v_fn;
  END IF;

  -- ACL exatamente a de hoje: EXECUTE para authenticated e service_role; PUBLIC (grantee = 0) e anon sem.
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (EXECUTE só para authenticated e service_role) — revise antes de devolver o corpo vigente.', v_fn;
  END IF;
END $preflight_rollback_20261243$;

-- registrar_pagamento_recebido: corpo vigente da 20261197000000_dinheiro_exige_admin_atual.sql, SEM a recusa por
-- devolução viva no ramo de desfazer.
CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido(
    p_order_id uuid,
    p_recebido boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status          TEXT;
    v_payment_status  TEXT;
    v_payment_method  TEXT;
    v_caller          UUID := auth.uid();
    v_antes           TEXT;
    v_depois          TEXT;
    v_ja_estava       BOOLEAN := FALSE;
    v_recebido_em     TIMESTAMPTZ;
    v_recebido_por    UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';
    END IF;

    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';
    END IF;

    -- NULL nao e nem "recebi" nem "desfiz": sem esta recusa o ELSE de
    -- `IF p_recebido` o tratava como DESFAZER (20261195000000). Vem DEPOIS da
    -- autorizacao (quem nao e admin nao aprende nada) e ANTES do SELECT ... FOR
    -- UPDATE, para recusar sem esperar a linha de quem esta gravando.
    IF p_recebido IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22004',
            MESSAGE = 'Informe se o pagamento foi recebido (true) ou desfeito (false).';
    END IF;

    SELECT status, payment_status, payment_method,
           pagamento_recebido_em, pagamento_recebido_por
      INTO v_status, v_payment_status, v_payment_method,
           v_recebido_em, v_recebido_por
      FROM public.marketplace_orders
     WHERE id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'Pedido cancelado não recebe pagamento.';
    END IF;

    IF v_payment_method = 'online' THEN
        RAISE EXCEPTION 'Este pedido é pago pelo site: quem confirma o pagamento é o gateway, não a loja.';
    END IF;

    v_antes := v_payment_status;

    IF p_recebido THEN
        IF v_payment_status = 'recebido_na_entrega' THEN
            v_ja_estava := TRUE;
            v_depois := v_payment_status;
        ELSIF v_payment_status IS NOT NULL THEN
            RAISE EXCEPTION 'Este pedido já tem pagamento registrado como "%": não dá para marcar recebimento na entrega por cima.', v_payment_status;
        ELSE
            v_depois := 'recebido_na_entrega';
            UPDATE public.marketplace_orders
               SET payment_status = v_depois,
                   pagamento_recebido_em = now(),
                   pagamento_recebido_por = v_caller,
                   updated_at = now()
             WHERE id = p_order_id
             RETURNING pagamento_recebido_em, pagamento_recebido_por
                  INTO v_recebido_em, v_recebido_por;
        END IF;
    ELSE
        IF v_payment_status IS DISTINCT FROM 'recebido_na_entrega' THEN
            v_ja_estava := TRUE;
            v_depois := v_payment_status;
        ELSE
            v_depois := NULL;
            UPDATE public.marketplace_orders
               SET payment_status = NULL,
                   pagamento_recebido_em = NULL,
                   pagamento_recebido_por = NULL,
                   updated_at = now()
             WHERE id = p_order_id;
            v_recebido_em := NULL;
            v_recebido_por := NULL;
        END IF;
    END IF;

    IF NOT v_ja_estava THEN
        INSERT INTO public.marketplace_order_payment_history
            (order_id, acao, payment_status_antes, payment_status_depois, created_by)
        VALUES
            (p_order_id,
             CASE WHEN p_recebido THEN 'recebido' ELSE 'desfeito' END,
             v_antes, v_depois, v_caller);
    END IF;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'payment_status', v_depois,
        'pagamento_recebido_em', v_recebido_em,
        'pagamento_recebido_por', v_recebido_por,
        'ja_estava', v_ja_estava
    );
END;
$$;

-- Conferência final: o corpo voltou ao vigente (md5 sem CR); senão a transação inteira cai.
DO $posvoo_rollback_20261243$
DECLARE
  v_fn CONSTANT text := 'public.registrar_pagamento_recebido(uuid, boolean)';
  v_oid oid := to_regprocedure('public.registrar_pagamento_recebido(uuid, boolean)');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc
   WHERE oid = to_regprocedure('public.registrar_pagamento_recebido(uuid, boolean)');

  IF v_hash IS DISTINCT FROM '6584d62da7815a913b1e0cb86c108b0f' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: depois do rollback o corpo vivo de public.registrar_pagamento_recebido(uuid, boolean) tem hash % e devia ter 6584d62da7815a913b1e0cb86c108b0f — o rollback não vale.', COALESCE(v_hash, 'ausente');
  END IF;

  IF v_oid IS NULL OR NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proisstrict
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'jsonb'
          AND p.pronargs = 2
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: depois do CREATE OR REPLACE os atributos de % mudaram — o rollback não vale.', v_fn;
  END IF;

  -- ACL exatamente a de hoje: EXECUTE para authenticated e service_role; PUBLIC (grantee = 0) e anon sem.
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (EXECUTE só para authenticated e service_role) — o rollback não vale.', v_fn;
  END IF;
END $posvoo_rollback_20261243$;
