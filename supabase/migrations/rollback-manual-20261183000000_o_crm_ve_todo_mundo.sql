-- ============================================================================
-- Rollback manual — O CRM vê todo mundo (20261183000000)
-- ============================================================================
-- Restaura crm_visao(date, date) e crm_clientes(text, text, integer, integer)
-- com os corpos EXATOS de 20261178000000_o_crm_e_o_inicio_leem_a_loja.sql
-- (extraídos do arquivo original, conferidos por md5 contra o bloco fonte —
-- nenhuma linha própria desta migration sobrevive) e derruba os dois
-- ajudantes que só esta migration criou (crm__pedidos_nao_pagos,
-- crm__nunca_comprou — não existiam antes dela, então não há corpo anterior
-- para restaurar, só DROP). Reverter PRIMEIRO o front (ClientesDoCrm.tsx,
-- lib/crm.ts, types/crm.ts) para a versão sem os 2 grupos novos; só depois
-- executar este arquivo — senão a tela chama uma RPC que já voltou a não
-- devolver `valor_em_aberto`/segmentos novos enquanto o código novo ainda
-- espera por eles (o parser tolera a ausência, mas os dois grupos novos
-- somem da lista até o front também voltar).
-- psql -1 -f — nunca pelo db-apply. Sem BEGIN/COMMIT de nível superior.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.crm_visao(p_inicio date, p_fim date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
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
                             FROM (SELECT segmento, count(*) AS clientes, sum(receita) AS receita FROM rfm GROUP BY segmento) s),
                          '[]'::jsonb)
  ) INTO v_res;
  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_clientes(
  p_segmento text DEFAULT NULL,
  p_busca text DEFAULT NULL,
  p_limite integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_busca text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_digitos text;
  v_res jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  v_digitos := NULLIF(regexp_replace(COALESCE(v_busca, ''), '\D', '', 'g'), '');

  WITH base AS (
    SELECT c.*, COALESCE(pr.full_name, c.nome) AS nome_exibido
      FROM public.crm__clientes_rfm(now()) c
      LEFT JOIN public.profiles pr ON pr.id = c.user_id
     WHERE (p_segmento IS NULL OR c.segmento = p_segmento)
       AND (v_busca IS NULL
            OR COALESCE(pr.full_name, c.nome, '') ILIKE '%' || v_busca || '%'
            OR COALESCE(c.email, '') ILIKE '%' || v_busca || '%'
            OR (v_digitos IS NOT NULL AND length(v_digitos) >= 4 AND COALESCE(c.whatsapp, '') LIKE '%' || v_digitos || '%'))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'clientes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'chave', b.chave, 'user_id', b.user_id, 'nome', b.nome_exibido, 'whatsapp', b.whatsapp, 'email', b.email,
        'pedidos', b.pedidos_total, 'receita', b.receita_total, 'ticket_medio',
        CASE WHEN b.pedidos_total > 0 THEN round(b.receita_total / b.pedidos_total, 2) ELSE 0 END,
        'primeira_compra', b.primeira_compra, 'ultima_compra', b.ultima_compra,
        'dias_sem_comprar', b.dias_sem_comprar, 'r', b.r, 'f', b.f, 'm', b.m,
        'segmento', b.segmento, 'canal_preferido', b.canal_preferido
      ) ORDER BY b.receita_total DESC, b.ultima_compra DESC)
      FROM (SELECT * FROM base ORDER BY receita_total DESC, ultima_compra DESC
             LIMIT LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200)
            OFFSET GREATEST(COALESCE(p_offset, 0), 0)) b), '[]'::jsonb)
  ) INTO v_res;
  RETURN v_res;
END;
$$;

DROP FUNCTION IF EXISTS public.crm__pedidos_nao_pagos(timestamptz);
DROP FUNCTION IF EXISTS public.crm__nunca_comprou(timestamptz);
