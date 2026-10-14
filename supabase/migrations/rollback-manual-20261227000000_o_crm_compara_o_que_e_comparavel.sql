-- ============================================================================
-- Rollback manual — o CRM compara o que é comparável (20261227000000)
-- ============================================================================
-- Devolve, byte a byte, o corpo de public.crm_visao(date,date) que a
-- 20261199000000_portas_do_painel_exigem_admin_atual.sql deixou (md5
-- 7f6ec1bc0fa9f40591c0b577201b7c36): a taxa de devolução volta a somar toda devolução
-- do período sobre a receita das vendas que sobraram (e a passar de 100%), e o
-- período anterior volta a ser comparado inteiro, mesmo quando o atual termina
-- agora. Mesma assinatura, mesmo STABLE SECURITY DEFINER, mesmo search_path, mesma
-- ACL (CREATE OR REPLACE preserva a vigente); nada é apagado.
--
-- ORDEM: este rollback vem ANTES do rollback da 20261199000000 (o dela recusa
-- enquanto uma redefinição posterior de crm_visao estiver no ar).
--
-- DADOS: a migration não gravou nada em linha nenhuma; não há dado a desfazer.
--
-- PRÉ-VOO: o DO $preflight_rollback_20261227$ recusa com B1_BASELINE_DIVERGENT —
-- ANTES de qualquer escrita — se o corpo VIVO (md5 de replace(prosrc, E'\r', ''))
-- não for exatamente o que a 20261227000000 deixou: desfazer por cima de uma
-- redefinição POSTERIOR apagaria a dela em silêncio, e desfazer duas vezes não tem
-- o que desfazer.
--
-- Executar via psql -1 -f (nunca pelo db-apply, que registraria este rollback no
-- ledger como migration nova). Sem BEGIN/COMMIT de nível superior neste arquivo.
-- ============================================================================

DO $preflight_rollback_20261227$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.crm_visao(date,date)', 'c33073503fccc6caa5f1085265501eae')
      ) AS esperado(assinatura, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o que a 20261227000000 deixou — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
END $preflight_rollback_20261227$;

-- crm_visao: corpo vigente da 20261199000000_portas_do_painel_exigem_admin_atual.sql.
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
    SELECT * FROM v WHERE v.dia BETWEEN v_ant_inicio AND v_ant_fim
  ), primeira AS (
    SELECT v.chave, min(v.pago_em) AS primeira FROM v WHERE v.chave IS NOT NULL GROUP BY v.chave
  ), rfm AS (
    SELECT * FROM public.crm__clientes_rfm(v_fim_ts)
  ), devolvido AS (
    SELECT COALESCE(sum(r.amount), 0) AS valor FROM public.order_refunds r
     WHERE r.status = 'concluido' AND public.fin__dia(r.concluido_em) BETWEEN p_inicio AND p_fim
  ), devolvido_manual AS (
    SELECT COALESCE(sum(d.valor_reembolso), 0) AS valor FROM public.devolucoes d
     WHERE d.status = 'concluida' AND d.reembolso_manual AND public.fin__dia(d.concluida_em) BETWEEN p_inicio AND p_fim
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
                                     ELSE round(((SELECT valor FROM devolvido) + (SELECT valor FROM devolvido_manual)) / sum(total), 4) END
                           FROM atual)
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

-- CONFERÊNCIA no instante do rollback: aborta se o corpo vivo não voltou ao vigente (o da
-- 20261199000000), se algum atributo mudou, ou se a ACL deixou de ser PUBLIC não, anon não,
-- authenticated sim, service_role sim.
DO $conferencia_rollback_20261227$
DECLARE
  v_fn CONSTANT text := 'public.crm_visao(date,date)';
  v_oid oid := to_regprocedure('public.crm_visao(date,date)');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '7f6ec1bc0fa9f40591c0b577201b7c36' THEN
    RAISE EXCEPTION 'conferencia rollback 20261227: corpo vivo de % (hash %) não voltou ao vigente', v_fn, COALESCE(v_hash, 'ausente');
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
    RAISE EXCEPTION 'conferencia rollback 20261227: atributos de % mudaram', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia rollback 20261227: % aberta para PUBLIC — o estado de antes não tinha PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261227: anon executa %', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261227: authenticated ou service_role sem EXECUTE em %', v_fn;
  END IF;
END $conferencia_rollback_20261227$;
