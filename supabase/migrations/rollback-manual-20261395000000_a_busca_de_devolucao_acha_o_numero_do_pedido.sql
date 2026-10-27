-- ============================================================================
-- Rollback manual — a busca de devolucao acha o numero do pedido (20261395000000)
-- ============================================================================
-- Recria public.admin_devolucoes_listar(text, text, integer, integer) com o corpo VIGENTE de antes (o da 20261199000000, byte a byte: o md5 de
-- replace(prosrc, E'\r', '') volta a ser 5a632e0a239104598dcdc4eb323c09b1). Assinatura, SECURITY DEFINER, STABLE, search_path, retorno jsonb e ACL são os
-- mesmos; OID e dono não mudam (CREATE OR REPLACE). Nenhum GRANT nem REVOKE neste arquivo.
--
-- COM ELE VOLTA O DEFEITO descrito no cabeçalho da migration 20261395000000.
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se a função não existir ou tiver sobrecarga; se o corpo vivo não for o DESTA migration
-- (rodar de novo, já desfeito, recusa); se os atributos não forem os de sempre; ou se a ACL não for a conhecida. O pós-voo recusa se o
-- corpo não voltou ao vigente ou se OID, dono, ACL ou atributos mudaram.
--
-- ORDEM: este vem ANTES de qualquer rollback da 20261199000000 (o dela não olha o corpo vivo). Executar pelo aplicar-migrations.yml (apaga o
-- registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261395000000$
DECLARE
  v_fn CONSTANT text := 'public.admin_devolucoes_listar(text, text, integer, integer)';
  v_oid oid := to_regprocedure('public.admin_devolucoes_listar(text, text, integer, integer)');
  v_hash text;
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % ausente; nada a reverter.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_devolucoes_listar') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: admin_devolucoes_listar tem sobrecarga em public — meça a loja e revise antes de seguir.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '989a6c6151eb35efc7c834c6cce20f01' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) não é o da 20261395000000; revise antes de reverter.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prokind = 'f'
          AND p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proisstrict
          AND p.pronargs = 4
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_status text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos — revise antes de sobrescrever.', v_fn;
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (authenticated e service_role sim; anon e PUBLIC não) — revise antes de sobrescrever.', v_fn;
  END IF;
  PERFORM set_config('ikcous.busca395_rb_atributos', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)::text, true);
END $preflight_rollback_20261395000000$;

CREATE OR REPLACE FUNCTION public.admin_devolucoes_listar(p_status text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_busca text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_limite integer := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_total integer;
  v_itens jsonb;
  v_contagem jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'solicitada', count(*) FILTER (WHERE status = 'solicitada'),
    'aprovada', count(*) FILTER (WHERE status = 'aprovada'),
    'em_transito', count(*) FILTER (WHERE status = 'em_transito'),
    'recebida', count(*) FILTER (WHERE status = 'recebida'),
    'concluida', count(*) FILTER (WHERE status = 'concluida'),
    'recusada', count(*) FILTER (WHERE status = 'recusada'),
    'cancelada', count(*) FILTER (WHERE status = 'cancelada'),
    'reprovada', count(*) FILTER (WHERE status = 'reprovada')
  ) INTO v_contagem FROM public.devolucoes;

  WITH base AS (
    SELECT d.*, o.customer_name AS cliente_nome, o.customer_data ->> 'whatsapp' AS cliente_whatsapp
      FROM public.devolucoes d
      JOIN public.marketplace_orders o ON o.id = d.order_id
     WHERE (p_status IS NULL OR d.status = p_status)
       AND (v_busca IS NULL
            OR d.protocolo ILIKE '%' || v_busca || '%'
            OR o.customer_name ILIKE '%' || v_busca || '%'
            OR d.order_id::text ILIKE v_busca || '%')
  )
  SELECT (SELECT count(*) FROM base),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', b.id, 'protocolo', b.protocolo, 'order_id', b.order_id,
            'cliente_nome', b.cliente_nome, 'cliente_whatsapp', b.cliente_whatsapp,
            'tipo', b.tipo, 'motivo', b.motivo, 'status', b.status,
            'resolucao_desejada', b.resolucao_desejada, 'metodo_retorno', b.metodo_retorno,
            'modalidade', b.modalidade, 'valor_itens', b.valor_itens,
            'prazo_ate', b.prazo_ate, 'created_at', b.created_at
          ) ORDER BY b.created_at DESC)
          FROM (SELECT * FROM base ORDER BY created_at DESC LIMIT v_limite OFFSET v_offset) b), '[]'::jsonb)
    INTO v_total, v_itens;

  RETURN jsonb_build_object('total', v_total, 'contagem', v_contagem, 'itens', v_itens);
END;
$$;

DO $posvoo_rollback_20261395000000$
DECLARE
  v_fn CONSTANT text := 'public.admin_devolucoes_listar(text, text, integer, integer)';
  v_oid oid := to_regprocedure('public.admin_devolucoes_listar(text, text, integer, integer)');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '5a632e0a239104598dcdc4eb323c09b1' THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261395000000: corpo vivo (hash %) não voltou ao vigente', COALESCE(v_hash, 'ausente');
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM current_setting('ikcous.busca395_rb_atributos')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261395000000: atributos, dono, OID ou ACL de % mudaram', v_fn;
  END IF;
END $posvoo_rollback_20261395000000$;

NOTIFY pgrst, 'reload schema';
