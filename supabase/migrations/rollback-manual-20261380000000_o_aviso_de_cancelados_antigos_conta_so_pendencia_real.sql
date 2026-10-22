-- Rollback manual da 20261380000000. Devolve get_admin_orders_cancelados_recentes da 20261199000000
-- byte a byte (LF), mantendo OID, dono, atributos e ACL; nao toca em dados.
-- ATENCAO: o aviso do botao de alerta volta a contar TODO cancelado antigo, tenha pendencia ou
-- nao (o defeito de origem). O front desta release escreve "ainda estao pendentes" em cima desse
-- numero: reverter o front ANTES do rollback.
-- O pre-voo exige o corpo da 20261380: segundo rollback ou sucessora desconhecida recusa.
-- Sem controle de transacao: o aplicador fornece a transacao inteira.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261380000000$
DECLARE
  r record;
  v_hash text;
  v_atributos jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.get_admin_orders_cancelados_recentes(integer,integer,integer)', '99a9e4cb232aef020bf297ddcd1901f0', '9567454f17698f3f0624cca0b06458cd')
  ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos FROM pg_proc p
     WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) nao e o corpo desta migration; revise antes de desfazer.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = to_regprocedure(r.assinatura)
         AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
         AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
         AND l.lanname = 'plpgsql' AND p.prorettype = 'jsonb'::regtype
         AND pg_get_function_identity_arguments(p.oid) = 'p_dias integer, p_page integer, p_page_size integer'
         AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_orders_cancelados_recentes') = 1
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_orders_cancelados_recentes tem assinatura, atributos ou permissoes diferentes dos esperados.';
    END IF;
    -- Fotografar OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
    PERFORM set_config('ikcous.cancelados1380_atributos', v_atributos::text, true);
  END LOOP;
END $preflight_rollback_20261380000000$;

CREATE OR REPLACE FUNCTION public.get_admin_orders_cancelados_recentes(p_dias integer DEFAULT 90, p_page integer DEFAULT 0, p_page_size integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_total_count BIGINT;
    v_fora_da_janela BIGINT;
    v_data JSONB;
    v_offset INTEGER;
BEGIN
    -- Authorization check (mesmo gate da get_admin_orders_paged).
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;
    -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;

    -- Contagem, numa passada só: dentro da janela (é o total que o laço do
    -- front persegue) e fora dela (o número que impede o recorte de
    -- mentir). p_dias NULL = sem janela: dentro = todos, fora = 0.
    SELECT
        COUNT(*) FILTER (
          WHERE p_dias IS NULL
             OR cancelado_em >= now() - make_interval(days => p_dias)
        ),
        COUNT(*) FILTER (
          WHERE p_dias IS NOT NULL
            AND cancelado_em < now() - make_interval(days => p_dias)
        )
      INTO v_total_count, v_fora_da_janela
      FROM (
        SELECT o.id,
               COALESCE(h.cancelado_em, o.updated_at) AS cancelado_em
          FROM public.marketplace_orders o
          LEFT JOIN LATERAL (
            SELECT MAX(hi.created_at) AS cancelado_em
              FROM public.marketplace_order_history hi
             WHERE hi.order_id = o.id
               AND hi.new_status = 'cancelled'
          ) h ON TRUE
         WHERE o.status = 'cancelled'
      ) c;

    -- Linhas enxutas: as 23 colunas que o mapper e o painel leem, mais a
    -- coluna nova do achado 1 (rodada 2), na ordem de atenção do
    -- cancelamento (mais recente primeiro). Nenhum item, nenhum endereço.
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT jsonb_build_object(
            'id', c.id,
            'user_id', c.user_id,
            'customer_name', c.customer_name,
            'customer_data', c.customer_data,
            'total', c.total,
            'subtotal', c.subtotal,
            'shipping', c.shipping,
            'discount', c.discount,
            'payment_method', c.payment_method,
            'payment_status', c.payment_status,
            'status', c.status,
            'notes', c.notes,
            'coupon_code', c.coupon_code,
            'tracking_code', c.tracking_code,
            'cancelled_after_shipping', c.cancelled_after_shipping,
            'returned_to_seller_at', c.returned_to_seller_at,
            'pagamento_recebido_em', c.pagamento_recebido_em,
            'pagamento_recebido_por', c.pagamento_recebido_por,
            'canal', c.canal,
            'vendedor_id', c.vendedor_id,
            'created_at', c.created_at,
            'updated_at', c.updated_at,
            'cancelado_em', c.cancelado_em,
            'valor_devolvido_por_devolucao', c.valor_devolvido_por_devolucao,
            'valor_estornado', c.valor_estornado
        ) AS t
        FROM (
            SELECT o.id,
                   o.user_id,
                   o.customer_name,
                   o.customer_data,
                   o.total,
                   o.subtotal,
                   o.shipping,
                   o.discount,
                   o.payment_method,
                   o.payment_status,
                   o.status,
                   o.notes,
                   o.coupon_code,
                   o.tracking_code,
                   o.cancelled_after_shipping,
                   o.returned_to_seller_at,
                   o.pagamento_recebido_em,
                   o.pagamento_recebido_por,
                   o.canal,
                   o.vendedor_id,
                   o.created_at,
                   o.updated_at,
                   COALESCE(h.cancelado_em, o.updated_at) AS cancelado_em,
                   COALESCE((SELECT sum(d.valor_reembolso) FROM public.devolucoes d
                              WHERE d.order_id = o.id AND d.status = 'concluida' AND d.reembolso_manual), 0)
                     AS valor_devolvido_por_devolucao,
                   -- Achado A4 (revisão 26/09/2026, rodada 3): o "Devolver
                   -- agora" também precisa saber o que já saiu pelo ledger
                   -- CONFIRMADO (order_refunds concluído, coluna somada só em
                   -- concluir_estorno) — sem isto, um estorno parcial já
                   -- pago pelo MP não descontava do valor que falta.
                   o.valor_estornado
              FROM public.marketplace_orders o
              LEFT JOIN LATERAL (
                SELECT MAX(hi.created_at) AS cancelado_em
                  FROM public.marketplace_order_history hi
                 WHERE hi.order_id = o.id
                   AND hi.new_status = 'cancelled'
              ) h ON TRUE
             WHERE o.status = 'cancelled'
               AND (p_dias IS NULL OR COALESCE(h.cancelado_em, o.updated_at) >= now() - make_interval(days => p_dias))
             ORDER BY COALESCE(h.cancelado_em, o.updated_at) DESC, o.created_at DESC
             LIMIT p_page_size
            OFFSET v_offset
        ) c
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'fora_da_janela', v_fora_da_janela
    );
END;
$$;

DO $conferencia_rollback_20261380000000$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_admin_orders_cancelados_recentes(integer,integer,integer)')
      AND md5(replace(p.prosrc, E'\r', '')) = '99a9e4cb232aef020bf297ddcd1901f0'
      AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.cancelados1380_atributos')::jsonb
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261380 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_rollback_20261380000000$;

NOTIFY pgrst, 'reload schema';
