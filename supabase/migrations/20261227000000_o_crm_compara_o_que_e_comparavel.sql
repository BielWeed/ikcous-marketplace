-- ============================================================================
-- Migration 20261227000000 — o CRM compara o que é comparável
-- (números do painel; caçada de 14/10/2026 em Postgres descartável; só LEITURA)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE (dois números de public.crm_visao)
--
-- 1a. "Taxa de devolução" passava de 100%. O numerador somava TODA devolução concluída
-- no período (order_refunds concluído + reembolso manual de devolução) e o denominador
-- era a receita de crm__vendas — que EXCLUI pedido cancelado e pedido estornado
-- (20261178000000: payment_status fora de pago/pago_apos_expirar/recebido_na_entrega e
-- status fora de cancelled/returned). Quando um pedido é devolvido por inteiro
-- (concluir_estorno vira payment_status = 'estornado' ao alcançar o total), ele SAÍA do
-- denominador e continuava no numerador: 2 vendas de R$ 100 com 1 devolvida davam 100%
-- (certo: 50%); 3 vendas com 2 devolvidas davam 200% (certo: 66,7%); e pagar, cancelar
-- e estornar o pedido único dava 0%, porque o denominador ficava vazio.
--
-- 1b. "vs. ontem" (e "vs. N dias antes") comparava o período de hoje, que só vai até
-- AGORA, com o período anterior INTEIRO: às 9h, vender no mesmo ritmo de ontem mostrava
-- uma queda enorme. Isto é o mesmo defeito da semana passada no Início (20261228000000).
--
-- 2. A REGRA NOVA
--
-- 2a. A taxa fala de UMA turma de vendas. Embaixo: as vendas PAGAS cujo pagamento caiu no
-- período (dia em America/Sao_Paulo de COALESCE(pagamento_recebido_em, paid_at)),
-- INCLUSIVE as que depois foram estornadas ou canceladas — a mesma régua de "venda" do
-- Financeiro (fin__movimentos: pago, pago_apos_expirar, recebido_na_entrega e estornado).
-- Em cima: só as devoluções DESSAS vendas, por pedido e nunca mais que o total do pedido:
--   * pedido com payment_status = 'estornado': o total (voltou ao cliente — pelo ledger do
--     app, por estorno feito fora do app ou por venda anulada no balcão);
--   * senão: o que o ledger concluiu (order_refunds.status = 'concluido') + o reembolso
--     manual de devolução concluída (devolucoes.reembolso_manual), limitado ao total
--     (LEAST) — o limite é só rede de segurança: com dado consistente a soma já não passa.
-- Resultado: 0 <= taxa <= 1 sempre; sem venda no período a taxa é 0 (nunca divide por zero).
-- SIGNIFICADO que muda: a devolução entra no período da VENDA, não no da devolução. Uma
-- venda de março devolvida em abril conta na taxa de março (a de abril não a carrega).
--
-- 2b. Quando o período TERMINA hoje (p_fim = hoje em São Paulo), o último dia do período
-- anterior só entra até a MESMA hora de agora. Os outros dias do anterior seguem inteiros.
-- Vale para receita, pedidos e valor médio do anterior. Período que não termina hoje não
-- muda. Nenhum parâmetro novo, nenhuma coluna nova: o formato do JSON é o mesmo.
--
-- 3. O QUE ACONTECE EM CADA CASO
--
--   * Sem venda paga no período: taxa 0.
--   * Venda paga no período, devolvida em parte (R$ 30 de R$ 100): entra R$ 100 embaixo e
--     R$ 30 em cima. Devolvida em parte E depois por inteiro: 100 em cima (e o pedido vira
--     'estornado').
--   * Venda paga e CANCELADA com estorno integral: 100% daquela venda (e nunca mais).
--   * Venda do balcão ANULADA no ato (anular_venda_presencial): vira 'estornado' sem linha
--     de ledger e entra como 100% devolvida — o mesmo que o Financeiro mostra (venda e
--     estorno do mesmo valor). Antes ela ficava fora dos dois lados.
--   * Devolução concluída de venda de OUTRO período: não entra neste.
--   * Devolução manual somada ao ledger acima do total do pedido (dado que não deveria
--     existir): limitada ao total do pedido.
--   * Pedido pago sem nenhuma devolução (inclusive cancelado sem estorno): entra embaixo
--     com 0 em cima.
--
-- 4. QUEM LÊ
--
-- src/lib/crm.ts (mapeamento de crm_visao) e as telas do CRM: o formato (colunas e chaves
-- do JSON) é IDÊNTICO; só mudam os valores de kpis.taxa_devolucao, kpis.receita_anterior,
-- kpis.pedidos_anterior e kpis.ticket_medio_anterior. As travas de admin (is_admin e
-- is_admin_atual) são as mesmas. Assinatura, STABLE, SECURITY DEFINER e search_path iguais.
--
-- 5. DADOS EXISTENTES
--
-- Nenhuma linha é lida para decidir nem reescrita ao aplicar: só o corpo de UMA função muda.
-- Os números do CRM mudam na próxima leitura.
--
-- 6. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se o corpo vivo (md5 de replace(prosrc, E'\r', '')) não for o vigente (o da
-- 20261199000000) nem o que esta migration deixa; se os atributos ou a ACL não forem os
-- conhecidos; ou se faltar coluna/função que o corpo novo lê. Os hashes são o md5 REAL dos
-- corpos, amarrados ao texto por
-- tests/migration_o_crm_compara_o_que_e_comparavel_test.ts.
--
-- 7. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- O pré-voo aceita o corpo desta migration; CREATE OR REPLACE com o mesmo texto deixa o
-- mesmo estado: reaplicar é o mesmo que aplicar uma vez. Sem BEGIN/COMMIT de nível superior
-- (regra da casa): quem abre a transação é o aplicador; o pré-voo, a troca do corpo e a
-- conferência final caem juntos ou não caem.
--
-- 8. ORDEM E ROLLBACK
--
-- Depois da 20261199000000 (o pré-voo recusa sem ela). Independe da 20261228000000 (outra
-- função). ROLLBACK MANUAL: rollback-manual-20261227000000_o_crm_compara_o_que_e_comparavel.sql
-- devolve o corpo da 20261199000000 byte a byte. Este rollback vem ANTES do rollback da
-- 20261199000000 (o da 99 recusa enquanto houver redefinição posterior no ar). A 8e
-- (lote 92-202) aceita este corpo como sucessor do da 99.
--
-- 9. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.crm_visao(date,date)');
--      -- esperado: c33073503fccc6caa5f1085265501eae.
--   2. Como admin: public.crm_visao(d, d)->'kpis'->>'taxa_devolucao' entre 0 e 1.
--   3. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/numeros-do-painel-viva.cjs (rpc-ci).
-- ============================================================================

DO $preflight_20261227$
DECLARE
  v_fn CONSTANT text := 'public.crm_visao(date,date)';
  v_oid oid := to_regprocedure('public.crm_visao(date,date)');
  v_hash text;
  v_public boolean;
  v_anon boolean;
  v_auth boolean;
  v_servico boolean;
  v_falta text;
  r record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'crm_visao') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: crm_visao tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO: o vigente (o da 20261199000000) (aplica) ou o desta migration (reaplicar é no-op).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.crm_visao(date,date)', '7f6ec1bc0fa9f40591c0b577201b7c36', 'c33073503fccc6caa5f1085265501eae')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente antes desta migration nem o que ela deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- Atributos que o CREATE OR REPLACE reescreve: têm de ser os de sempre.
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
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  -- O PL/pgSQL só acusa coluna ou função ausente na hora de EXECUTAR, não ao criar: confere antes.
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['marketplace_orders.id', 'marketplace_orders.total', 'marketplace_orders.payment_status', 'marketplace_orders.pagamento_recebido_em', 'marketplace_orders.paid_at', 'order_refunds.order_id', 'order_refunds.amount', 'order_refunds.status', 'devolucoes.order_id', 'devolucoes.valor_reembolso', 'devolucoes.status', 'devolucoes.reembolso_manual']) AS d(item)
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = to_regclass('public.' || split_part(d.item, '.', 1))
              AND a.attname = split_part(d.item, '.', 2)
              AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: colunas que o corpo novo lê não existem: % — aplique as migrations anteriores antes.', v_falta;
  END IF;
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['public.crm__vendas(timestamptz)', 'public.crm__clientes_rfm(timestamptz)', 'public.crm__pedidos_nao_pagos(timestamptz)', 'public.crm__nunca_comprou(timestamptz)', 'public.fin__dia(timestamptz)', 'public.fin__hoje()', 'public.is_admin()', 'public.is_admin_atual()']) AS d(item)
   WHERE to_regprocedure(d.item) IS NULL;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: funções que o corpo novo chama não existem: % — aplique as migrations anteriores antes.', v_falta;
  END IF;

  -- ACL exatamente a de hoje (PUBLIC medido por aclexplode, grantee = 0): o CREATE OR REPLACE a preserva.
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
  v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  v_servico := has_function_privilege('service_role', v_oid, 'EXECUTE');
  IF NOT (NOT v_public AND NOT v_anon AND v_auth AND v_servico) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC=%, anon=%, authenticated=%, service_role=%) — meça a loja e revise.', v_fn, v_public, v_anon, v_auth, v_servico;
  END IF;
END $preflight_20261227$;

-- crm_visao: corpo vigente da 20261199000000_portas_do_painel_exigem_admin_atual.sql,
-- com a taxa de devolução da MESMA turma de vendas e o anterior cortado na mesma hora.
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

-- CONFERÊNCIA no instante do apply: aborta se o corpo vivo não é o novo, se algum atributo
-- mudou, ou se a ACL não ficou PUBLIC não, anon não, authenticated sim, service_role sim.
DO $conferencia_20261227$
DECLARE
  v_fn CONSTANT text := 'public.crm_visao(date,date)';
  v_oid oid := to_regprocedure('public.crm_visao(date,date)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261227: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'crm_visao') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261227: crm_visao ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'c33073503fccc6caa5f1085265501eae' THEN
    RAISE EXCEPTION 'conferencia 20261227: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
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
    RAISE EXCEPTION 'conferencia 20261227: atributos de % mudaram', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261227: % alcançável por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261227: anon executa %', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261227: authenticated perdeu EXECUTE em %', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261227: service_role perdeu EXECUTE em %', v_fn;
  END IF;
END $conferencia_20261227$;
