-- ============================================================================
-- Rollback manual — a grade do CRM mede a recência do mesmo instante da lista (20261232000000)
-- ============================================================================
-- Recria public.crm_visao(date,date) com o corpo VIGENTE de antes (o da 20261227000000, byte a byte: o md5
-- de replace(prosrc, E'\r', '') volta a ser c33073503fccc6caa5f1085265501eae, e a prova viva confere). A
-- assinatura, SECURITY DEFINER, STABLE, search_path e retorno são os mesmos da migration.
--
-- A ACL NÃO é tocada: CREATE OR REPLACE preserva dono e privilégios, e este arquivo não tem nenhum
-- GRANT nem REVOKE — nunca devolve EXECUTE a anon ou a PUBLIC.
--
-- COM ELE VOLTA O DEFEITO: com o período terminando hoje, a grade volta a ver cada cliente 1 dia mais
-- velho do que a lista (quem comprou há 30 dias volta a aparecer em "Promissores" na grade e em "Novos"
-- na lista).
--
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se a função não existir ou tiver sobrecarga; se o corpo vivo
-- não for um dos dois conhecidos (o desta migration, ou o vigente — e então rodar de novo reescreve o
-- mesmo texto); se os atributos não forem os de sempre; ou se PUBLIC/anon tiverem EXECUTE ou
-- authenticated/service_role não tiverem. A conferência final recusa se o corpo não voltou ao vigente,
-- se algum atributo mudou ou se a ACL mudou.
--
-- ORDEM: este vem ANTES do rollback da 20261227000000 (o dela recusa enquanto esta estiver no ar) e do da
-- 20261199000000, se forem rodados.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT
-- de nível superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

DO $preflight_rollback_20261232$
DECLARE
  v_fn CONSTANT text := 'public.crm_visao(date,date)';
  v_oid oid := to_regprocedure('public.crm_visao(date,date)');
  v_hash text;
  r record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe — nada a devolver.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'crm_visao') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: crm_visao tem sobrecarga em public — revise antes de devolver o corpo vigente.';
  END IF;

  -- O corpo vivo tem de ser o desta migration (desfaz) ou o vigente (já desfeito: reescreve o mesmo texto).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.crm_visao(date,date)', 'c33073503fccc6caa5f1085265501eae', '0dfda3ea5129c6f8aabfcf0052fd2936')
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
          AND p.provolatile = 's'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_inicio date, p_fim date'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos — revise antes de sobrescrever.', v_fn;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % está aberta para PUBLIC — o estado de antes nunca teve PUBLIC; revise a ACL antes.', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (anon sem, authenticated e service_role com) — revise a ACL antes.', v_fn;
  END IF;
END $preflight_rollback_20261232$;

-- crm_visao: corpo vigente da 20261227000000_o_crm_compara_o_que_e_comparavel.sql.
CREATE OR REPLACE FUNCTION public.crm_visao(p_inicio date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_dias integer;
  v_ant_inicio date;
  v_ant_fim date;
  v_fim_ts timestamptz;
  v_hoje date := public.fin__hoje();
  v_hora time := (now() AT TIME ZONE 'America/Sao_Paulo')::time;
  v_res jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio OR p_fim - p_inicio > 400 THEN
    RAISE EXCEPTION 'Período inválido (até 400 dias).' USING ERRCODE = '22023';
  END IF;
  v_dias := p_fim - p_inicio + 1;
  v_ant_fim := p_inicio - 1;
  v_ant_inicio := v_ant_fim - v_dias + 1;
  v_fim_ts := ((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo');

  WITH v AS (
    SELECT * FROM public.crm__vendas(v_fim_ts)
  ), atual AS (
    SELECT * FROM v WHERE v.dia BETWEEN p_inicio AND p_fim
  ), anterior AS (
    -- Período que termina HOJE: hoje só vai até agora, então o último dia do anterior
    -- também só vale até a MESMA hora (20261227000000). Fora disso, dias inteiros.
    SELECT * FROM v WHERE v.dia BETWEEN v_ant_inicio AND v_ant_fim
       AND (p_fim <> v_hoje OR v.dia < v_ant_fim
            OR (v.pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)
  ), primeira AS (
    SELECT v.chave, min(v.pago_em) AS primeira FROM v WHERE v.chave IS NOT NULL GROUP BY v.chave
  ), rfm AS (
    SELECT * FROM public.crm__clientes_rfm(v_fim_ts)
  ), turma AS (
    -- A turma da taxa de devolução: as vendas PAGAS no período, inclusive as que depois
    -- foram estornadas ou canceladas (a mesma régua de venda do Financeiro, fin__movimentos).
    -- Em cima só as devoluções DESSAS vendas: a taxa nunca passa de 100%.
    SELECT o.id, o.total::numeric AS total, o.payment_status
      FROM public.marketplace_orders o
     WHERE o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado')
       AND COALESCE(o.pagamento_recebido_em, o.paid_at) IS NOT NULL
       AND public.fin__dia(COALESCE(o.pagamento_recebido_em, o.paid_at)) BETWEEN p_inicio AND p_fim
  ), devolvido AS (
    -- Pedido estornado: o total voltou ao cliente (pelo app, fora dele ou no balcão). Senão, o
    -- que o ledger concluiu + o reembolso manual de devolução, nunca mais que o total do pedido.
    SELECT t.total,
           CASE WHEN t.payment_status = 'estornado' THEN t.total
                ELSE LEAST(t.total,
                           COALESCE((SELECT sum(r.amount) FROM public.order_refunds r
                                      WHERE r.order_id = t.id AND r.status = 'concluido'), 0)
                         + COALESCE((SELECT sum(d.valor_reembolso) FROM public.devolucoes d
                                      WHERE d.order_id = t.id AND d.status = 'concluida' AND d.reembolso_manual), 0))
           END AS valor
      FROM turma t
  ), nao_pagos AS (
    SELECT * FROM public.crm__pedidos_nao_pagos(v_fim_ts)
  ), nunca AS (
    SELECT * FROM public.crm__nunca_comprou(v_fim_ts)
  )
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'receita', (SELECT COALESCE(sum(total), 0) FROM atual),
      'receita_anterior', (SELECT COALESCE(sum(total), 0) FROM anterior),
      'pedidos', (SELECT count(*) FROM atual),
      'pedidos_anterior', (SELECT count(*) FROM anterior),
      'ticket_medio', (SELECT COALESCE(round(avg(total), 2), 0) FROM atual),
      'ticket_medio_anterior', (SELECT COALESCE(round(avg(total), 2), 0) FROM anterior),
      'clientes_compradores', (SELECT count(DISTINCT chave) FROM atual WHERE chave IS NOT NULL),
      'clientes_novos', (SELECT count(*) FROM primeira p WHERE public.fin__dia(p.primeira) BETWEEN p_inicio AND p_fim),
      'taxa_recompra', (SELECT CASE WHEN count(*) = 0 THEN 0
                                    ELSE round(count(*) FILTER (WHERE pedidos_total >= 2)::numeric / count(*), 4) END
                          FROM rfm),
      'receita_recorrente_pct', (SELECT CASE WHEN COALESCE(sum(a.total), 0) = 0 THEN 0
                                   ELSE round(COALESCE(sum(a.total) FILTER (WHERE a.pago_em > p.primeira), 0) / sum(a.total), 4) END
                                   FROM atual a JOIN primeira p ON p.chave = a.chave),
      'ltv_medio', (SELECT COALESCE(round(avg(receita_total), 2), 0) FROM rfm),
      'receita_em_risco', (SELECT COALESCE(sum(receita), 0) FROM rfm WHERE segmento IN ('em_risco', 'nao_pode_perder')),
      'taxa_devolucao', (SELECT CASE WHEN COALESCE(sum(total), 0) = 0 THEN 0
                                     ELSE round(sum(valor) / sum(total), 4) END
                           FROM devolvido)
    ),
    'canais', COALESCE((SELECT jsonb_agg(jsonb_build_object('canal', canal, 'receita', receita, 'pedidos', pedidos,
                                                            'ticket_medio', ticket) ORDER BY receita DESC)
                          FROM (SELECT canal, sum(total) AS receita, count(*) AS pedidos, round(avg(total), 2) AS ticket
                                  FROM atual GROUP BY canal) c), '[]'::jsonb),
    'formas', COALESCE((SELECT jsonb_agg(jsonb_build_object('forma', forma, 'receita', receita, 'pedidos', pedidos)
                                         ORDER BY receita DESC)
                          FROM (SELECT forma, sum(total) AS receita, count(*) AS pedidos FROM atual GROUP BY forma) f), '[]'::jsonb),
    'funil', jsonb_build_object(
      'visitas', NULL,
      'produtos_vistos', NULL,
      'carrinhos', (SELECT count(DISTINCT u) FROM (
                      SELECT ci.user_id AS u FROM public.cart_items ci
                       WHERE public.fin__dia(ci.created_at) BETWEEN p_inicio AND p_fim
                      UNION
                      SELECT o.user_id FROM public.marketplace_orders o
                       WHERE o.canal = 'online' AND o.user_id IS NOT NULL
                         AND public.fin__dia(o.created_at) BETWEEN p_inicio AND p_fim) x WHERE u IS NOT NULL),
      'pedidos_criados', (SELECT count(*) FROM public.marketplace_orders o
                           WHERE o.canal = 'online' AND public.fin__dia(o.created_at) BETWEEN p_inicio AND p_fim),
      'pedidos_pagos', (SELECT count(*) FROM atual WHERE canal = 'online')
    ),
    'pipeline', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'quantidade', qtd, 'mais_antigo_em', antigo)
                                           ORDER BY ordem)
                            FROM (SELECT o.status, count(*) AS qtd, min(o.created_at) AS antigo,
                                         CASE o.status WHEN 'new' THEN 0 WHEN 'pending' THEN 1 WHEN 'processing' THEN 2
                                                       ELSE 3 END AS ordem
                                    FROM public.marketplace_orders o
                                   WHERE o.status IN ('new', 'pending', 'processing', 'shipping')
                                     AND COALESCE(o.payment_status, '') NOT IN ('aguardando', 'expirado', 'recusado')
                                   GROUP BY o.status) p), '[]'::jsonb),
    'segmentos', COALESCE((SELECT jsonb_agg(jsonb_build_object('segmento', segmento, 'clientes', clientes, 'receita', receita)
                                            ORDER BY receita DESC)
                             FROM (
                               SELECT segmento, count(*) AS clientes, sum(receita) AS receita FROM rfm GROUP BY segmento
                               UNION ALL
                               SELECT 'pediu_nao_pagou', count(*), COALESCE(sum(valor_em_aberto), 0) FROM nao_pagos
                               UNION ALL
                               SELECT 'nunca_comprou', count(*), 0 FROM nunca
                             ) s),
                          '[]'::jsonb)
  ) INTO v_res;
  RETURN v_res;
END;
$$;

DO $conferencia_rollback_20261232$
DECLARE
  v_fn CONSTANT text := 'public.crm_visao(date,date)';
  v_oid oid := to_regprocedure('public.crm_visao(date,date)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia rollback 20261232: % sumiu', v_fn;
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'c33073503fccc6caa5f1085265501eae' THEN
    RAISE EXCEPTION 'conferencia rollback 20261232: corpo vivo de % (hash %) não voltou ao vigente', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_inicio date, p_fim date'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'conferencia rollback 20261232: atributos de % mudaram', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia rollback 20261232: % alcançável por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261232: anon executa %', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261232: authenticated ou service_role perdeu EXECUTE em %', v_fn;
  END IF;
END $conferencia_rollback_20261232$;
