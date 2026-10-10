-- O CRM E O INÍCIO LEEM A LOJA (26/09/2026 — plano
-- docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md, tarefa 4;
-- spec docs/superpowers/specs/2026-09-26-inicio-crm-e-financeiro-do-painel-design.md).
--
-- O QUE FALTAVA: o painel tinha um dashboard de métricas gerais (receita,
-- pedidos, ticket, categorias), mas nenhuma leitura de CLIENTE (quem compra,
-- quem sumiu, quem vale mais), nenhum corte app × loja física, nenhum funil e
-- nenhuma tela inicial com o dinheiro do dia e as pendências do lojista.
--
-- O QUE ESTA MIGRATION FAZ (só LEITURA — nenhuma tabela nova, nenhuma escrita):
--   1. crm__vendas(p_ate): as vendas que contam (dinheiro reconhecido e pedido
--      não cancelado — a mesma régua do get_admin_analytics_v2), cada uma com a
--      CHAVE do cliente: a conta (user_id) ou, no balcão sem conta, o WhatsApp —
--      e o WhatsApp que já apareceu num pedido com conta vira aquela conta (o
--      mesmo cliente não conta duas vezes).
--   2. crm__clientes_rfm(p_ate): RFM híbrido para loja pequena (quintil puro
--      vira ruído abaixo de ~500 clientes): R e F por faixas fixas, M por
--      quintil (percent_rank), FM = ⌊(F+M)/2⌋ e os segmentos do Shopify
--      (campeoes, leais, ativos, novos, promissores, precisam_atencao,
--      quase_dormindo, em_risco, nao_pode_perder, hibernando), janela de 24
--      meses.
--   3. crm_visao(p_inicio, p_fim): KPIs com o período anterior de mesmo
--      tamanho, canais (app × loja física), formas de pagamento, funil
--      (carrinhos → pedidos criados → pagos; visitas e produtos vistos voltam
--      NULL porque o app não grava analytics_events hoje — número inventado
--      seria pior que a ausência), esteira de pedidos com a idade do mais
--      antigo e os segmentos.
--   4. crm_clientes(p_segmento, p_busca, p_limite, p_offset): a lista do CRM.
--   5. painel_inicio(): o Início — hoje × mesmo dia da semana passada, mês ×
--      mesmos dias do mês anterior, lucro estimado (DRE do Financeiro), saldo
--      em contas, a receber/a pagar em 7 dias, contas vencidas, pendências e a
--      série de 14 dias.
--
-- Toda RPC: SECURITY DEFINER, search_path fixo, gate is_admin() dentro.
--
-- COMO APLICAR: `node scripts/db-apply.cjs <este arquivo>` (sem BEGIN/COMMIT).
--
-- FICHA DE VERIFICAÇÃO:
--   1. SELECT public.painel_inicio();          -- como admin: jsonb com 'hoje'
--   2. SELECT public.crm_visao(current_date - 29, current_date) -> 'kpis';
--
-- ROLLBACK MANUAL: rollback-manual-20261178000000_o_crm_e_o_inicio_leem_a_loja.sql
-- (só DROP FUNCTION — não há dado a perder). psql -1 -f, nunca db-apply.

CREATE OR REPLACE FUNCTION public.crm__vendas(p_ate timestamptz)
RETURNS TABLE (
  order_id uuid, total numeric, canal text, forma text, pago_em timestamptz, dia date,
  chave text, user_id uuid, nome text, whatsapp text, email text
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH base AS (
    SELECT o.id, o.total::numeric AS total, o.canal, o.user_id, o.customer_name,
           public.fin__forma_do_pedido(o.payment_method, o.metodo_online) AS forma,
           COALESCE(o.pagamento_recebido_em, o.paid_at) AS pago_em,
           NULLIF(regexp_replace(COALESCE(o.customer_data ->> 'whatsapp', ''), '\D', '', 'g'), '') AS wa,
           NULLIF(btrim(COALESCE(o.customer_data ->> 'email', '')), '') AS email
      FROM public.marketplace_orders o
     WHERE o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
       AND o.status NOT IN ('cancelled', 'returned')
       AND COALESCE(o.pagamento_recebido_em, o.paid_at) IS NOT NULL
       AND COALESCE(o.pagamento_recebido_em, o.paid_at) <= p_ate
  ), wa_da_conta AS (
    SELECT DISTINCT ON (b.wa) b.wa, b.user_id
      FROM base b
     WHERE b.wa IS NOT NULL AND b.user_id IS NOT NULL
     ORDER BY b.wa, b.pago_em DESC
  )
  SELECT b.id, b.total, b.canal, b.forma, b.pago_em, public.fin__dia(b.pago_em),
         COALESCE(b.user_id::text, w.user_id::text, CASE WHEN b.wa IS NOT NULL THEN 'wa:' || b.wa END),
         COALESCE(b.user_id, w.user_id),
         NULLIF(btrim(b.customer_name), ''), b.wa, b.email
    FROM base b
    LEFT JOIN wa_da_conta w ON w.wa = b.wa AND b.user_id IS NULL
$$;

CREATE OR REPLACE FUNCTION public.crm__clientes_rfm(p_ate timestamptz)
RETURNS TABLE (
  chave text, user_id uuid, nome text, whatsapp text, email text,
  pedidos integer, receita numeric, ticket_medio numeric,
  primeira_compra timestamptz, ultima_compra timestamptz, dias_sem_comprar integer,
  pedidos_total integer, receita_total numeric,
  r integer, f integer, m integer, segmento text, canal_preferido text
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH v AS (
    SELECT * FROM public.crm__vendas(p_ate) WHERE chave IS NOT NULL
  ), agg AS (
    SELECT v.chave,
           (array_agg(v.user_id ORDER BY v.pago_em DESC) FILTER (WHERE v.user_id IS NOT NULL))[1] AS user_id,
           (array_agg(v.nome ORDER BY v.pago_em DESC) FILTER (WHERE v.nome IS NOT NULL))[1] AS nome,
           (array_agg(v.whatsapp ORDER BY v.pago_em DESC) FILTER (WHERE v.whatsapp IS NOT NULL))[1] AS whatsapp,
           (array_agg(v.email ORDER BY v.pago_em DESC) FILTER (WHERE v.email IS NOT NULL))[1] AS email,
           count(*) FILTER (WHERE v.pago_em > p_ate - interval '24 months')::integer AS pedidos,
           COALESCE(sum(v.total) FILTER (WHERE v.pago_em > p_ate - interval '24 months'), 0) AS receita,
           min(v.pago_em) AS primeira, max(v.pago_em) AS ultima,
           count(*)::integer AS pedidos_total, sum(v.total) AS receita_total,
           mode() WITHIN GROUP (ORDER BY v.canal) AS canal_preferido
      FROM v GROUP BY v.chave
  ), notas AS (
    SELECT a.*,
           (public.fin__dia(p_ate) - public.fin__dia(a.ultima))::integer AS dias,
           CASE WHEN public.fin__dia(p_ate) - public.fin__dia(a.ultima) <= 30 THEN 5
                WHEN public.fin__dia(p_ate) - public.fin__dia(a.ultima) <= 60 THEN 4
                WHEN public.fin__dia(p_ate) - public.fin__dia(a.ultima) <= 120 THEN 3
                WHEN public.fin__dia(p_ate) - public.fin__dia(a.ultima) <= 240 THEN 2
                ELSE 1 END AS r,
           CASE WHEN a.pedidos >= 6 THEN 5 WHEN a.pedidos >= 4 THEN 4 WHEN a.pedidos = 3 THEN 3
                WHEN a.pedidos = 2 THEN 2 ELSE 1 END AS f,
           LEAST(5, 1 + floor(percent_rank() OVER (ORDER BY a.receita) * 5))::integer AS m
      FROM agg a
  )
  SELECT n.chave, n.user_id, n.nome, n.whatsapp, n.email, n.pedidos, round(n.receita, 2),
         CASE WHEN n.pedidos > 0 THEN round(n.receita / n.pedidos, 2) ELSE 0 END,
         n.primeira, n.ultima, n.dias, n.pedidos_total, round(n.receita_total, 2),
         n.r, n.f, n.m,
         CASE
           WHEN n.r = 5 AND (n.f + n.m) / 2 >= 4 THEN 'campeoes'
           WHEN n.r = 5 AND (n.f + n.m) / 2 >= 2 THEN 'ativos'
           WHEN n.r = 5 THEN 'novos'
           WHEN n.r = 4 AND (n.f + n.m) / 2 >= 4 THEN 'leais'
           WHEN n.r = 4 AND (n.f + n.m) / 2 >= 2 THEN 'ativos'
           WHEN n.r = 4 THEN 'promissores'
           WHEN n.r = 3 AND (n.f + n.m) / 2 >= 4 THEN 'leais'
           WHEN n.r = 3 AND (n.f + n.m) / 2 = 3 THEN 'precisam_atencao'
           WHEN n.r = 3 THEN 'quase_dormindo'
           WHEN (n.f + n.m) / 2 >= 5 THEN 'nao_pode_perder'
           WHEN (n.f + n.m) / 2 >= 3 THEN 'em_risco'
           ELSE 'hibernando'
         END,
         n.canal_preferido
    FROM notas n
$$;

REVOKE ALL ON FUNCTION public.crm__vendas(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm__clientes_rfm(timestamptz) FROM PUBLIC, anon, authenticated;

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

CREATE OR REPLACE FUNCTION public.painel_inicio()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_hoje date := public.fin__hoje();
  v_mes_inicio date := date_trunc('month', public.fin__hoje())::date;
  v_mes_ant_inicio date := (date_trunc('month', public.fin__hoje()) - interval '1 month')::date;
  v_mes_ant_fim date;
  v_lucro numeric;
  v_res jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Mesmos dias do mês anterior (dia 1 até o mesmo dia do mês, ou o fim dele).
  v_mes_ant_fim := LEAST(v_mes_ant_inicio + (v_hoje - v_mes_inicio), v_mes_inicio - 1);
  v_lucro := (public.fin_dre(v_mes_inicio, v_hoje) ->> 'lucro_liquido')::numeric;

  WITH v AS (
    SELECT * FROM public.crm__vendas(now()) WHERE dia >= v_mes_ant_inicio - 14
  ), prev AS (
    SELECT m.*, COALESCE(m.vencimento, m.data) AS venc
      FROM public.fin__movimentos(NULL, NULL) m WHERE m.status = 'previsto'
  )
  SELECT jsonb_build_object(
    'hoje', jsonb_build_object(
      'receita', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia = v_hoje),
      'online', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia = v_hoje AND canal = 'online'),
      'presencial', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia = v_hoje AND canal = 'presencial'),
      'pedidos', (SELECT count(*) FROM v WHERE dia = v_hoje),
      'receita_semana_passada', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia = v_hoje - 7)
    ),
    'mes', jsonb_build_object(
      'receita', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia BETWEEN v_mes_inicio AND v_hoje),
      'receita_mes_anterior', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia BETWEEN v_mes_ant_inicio AND v_mes_ant_fim),
      'pedidos', (SELECT count(*) FROM v WHERE dia BETWEEN v_mes_inicio AND v_hoje),
      'ticket_medio', (SELECT COALESCE(round(avg(total), 2), 0) FROM v WHERE dia BETWEEN v_mes_inicio AND v_hoje),
      'lucro_estimado', v_lucro
    ),
    'saldo_total', (SELECT COALESCE(round(sum(s.saldo), 2), 0)
                      FROM public.fin__saldos() s JOIN public.fin_contas c ON c.id = s.conta_id WHERE c.ativa),
    'a_receber_7d', (SELECT COALESCE(sum(valor), 0) FROM prev WHERE tipo = 'entrada' AND venc <= v_hoje + 7),
    'a_pagar_7d', (SELECT COALESCE(sum(valor), 0) FROM prev WHERE tipo = 'saida' AND venc <= v_hoje + 7),
    'contas_vencidas', (SELECT count(*) FROM prev WHERE tipo = 'saida' AND venc < v_hoje),
    'pendencias', jsonb_build_object(
      'pedidos_para_preparar', (SELECT count(*) FROM public.marketplace_orders o
                                 WHERE o.status IN ('new', 'pending', 'processing')
                                   AND COALESCE(o.payment_status, '') NOT IN ('aguardando', 'expirado', 'recusado', 'estornado')),
      'devolucoes_abertas', (SELECT count(*) FROM public.devolucoes d
                              WHERE d.status IN ('solicitada', 'aprovada', 'em_transito', 'recebida')),
      'caixa_aberto', EXISTS (SELECT 1 FROM public.fin_caixa_sessoes s WHERE s.status = 'aberto'),
      'estoque_baixo', (SELECT count(*) FROM public.produtos p
                         WHERE p.deleted_at IS NULL AND COALESCE(p.ativo, true)
                           AND (
                             (NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active)
                              AND COALESCE(p.estoque, 0) <= COALESCE(p.estoque_minimo, 3))
                             OR EXISTS (SELECT 1 FROM public.product_variants pv
                                         WHERE pv.product_id = p.id AND pv.active
                                           AND COALESCE(pv.stock_increment, 0) <= COALESCE(p.estoque_minimo, 3))
                           ))
    ),
    'serie_14d', (SELECT jsonb_agg(jsonb_build_object(
                     'dia', d.dia::date,
                     'receita', COALESCE((SELECT sum(total) FROM v WHERE v.dia = d.dia::date), 0)
                   ) ORDER BY d.dia)
                    FROM generate_series((v_hoje - 13)::timestamp, v_hoje::timestamp, interval '1 day') AS d(dia))
  ) INTO v_res;
  RETURN v_res;
END;
$$;

DO $grants$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.crm_visao(date, date)',
    'public.crm_clientes(text, text, integer, integer)',
    'public.painel_inicio()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
  END LOOP;
END
$grants$;
