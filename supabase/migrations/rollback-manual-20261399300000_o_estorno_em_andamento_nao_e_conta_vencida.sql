-- Rollback manual da 20261399300000. Devolve painel_inicio ao corpo da 20261398000000 e fin_resumo ao da 20261199000000, byte a byte
-- (LF), mantendo OID, dono, atributos e ACL; nao toca em dados.
-- ATENCAO: reabre o defeito (o estorno em andamento volta a contar como conta vencida no Inicio e no "Vencido" da Visao do
-- Financeiro). O front nao precisa voltar.
-- O pre-voo exige os corpos DESTA migration (painel_inicio md5 8d58e15e7410afe0d254f37f38251df4; fin_resumo md5 a10e7f301eaf6b3edfac50bc87ff74bc): segundo rollback ou
-- sucessora desconhecida recusa, e nada e gravado (as duas funcoes caem juntas ou nenhuma).
-- Depois dele os corpos sao os vigentes (painel_inicio 01d29aedf98b7f95851c1a1001b5c7ca, o que o rollback da 20261398000000 exige; fin_resumo
-- 410668ed931d89e0a16a568b35df7973, o que o rollback da 20261199000000 exige).
-- Sem controle de transacao: o aplicador fornece a transacao inteira.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261399300$
DECLARE
  v_oid oid;
  v_hash text;
  v_atributos jsonb;
  r record;
BEGIN
  FOR r IN
    SELECT esperado.*, split_part(split_part(esperado.assinatura, '.', 2), '(', 1) AS nome
      FROM (VALUES
        ('public.painel_inicio()', '01d29aedf98b7f95851c1a1001b5c7ca', '8d58e15e7410afe0d254f37f38251df4'),
        ('public.fin_resumo(date,date)', '410668ed931d89e0a16a568b35df7973', 'a10e7f301eaf6b3edfac50bc87ff74bc')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    v_oid := to_regprocedure(r.assinatura);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % nao existe.', r.assinatura;
    END IF;
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nome) <> 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public - revise antes de desfazer.', r.nome;
    END IF;
    SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos FROM pg_proc p
     WHERE p.oid = v_oid;
    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) nao e o corpo desta migration; revise antes de desfazer.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = v_oid
            AND l.lanname = 'plpgsql'
            AND p.prokind = 'f'
            AND p.prosecdef
            AND p.provolatile = 's'
            AND NOT p.proretset
            AND p.proconfig = ARRAY['search_path=public']::text[]
            AND pg_get_function_result(p.oid) = 'jsonb'
            AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))
            AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
            AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
            AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                             WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       )
       OR pg_get_function_arguments(v_oid) IS DISTINCT FROM (CASE r.nome WHEN 'painel_inicio' THEN '' ELSE 'p_inicio date, p_fim date' END) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos, dono ou permissoes de % diferentes dos esperados.', r.assinatura;
    END IF;
    -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
    PERFORM set_config('ikcous.' || r.nome || '3993_atributos', v_atributos::text, true);
  END LOOP;
END $preflight_rollback_20261399300$;

CREATE OR REPLACE FUNCTION public.painel_inicio()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := public.fin__hoje();
  v_mes_inicio date := date_trunc('month', public.fin__hoje())::date;
  v_mes_ant_inicio date := (date_trunc('month', public.fin__hoje()) - interval '1 month')::date;
  v_mes_ant_fim date;
  v_hora time := (now() AT TIME ZONE 'America/Sao_Paulo')::time;
  v_mes_fim date;
  v_mes_ant_tem_o_dia boolean;
  v_lucro numeric;
  v_res jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Mesmos dias do mês anterior (dia 1 até o mesmo dia do mês, ou o fim dele).
  v_mes_ant_fim := LEAST(v_mes_ant_inicio + (v_hoje - v_mes_inicio), v_mes_inicio - 1);
  -- O dia de hoje existe no mês anterior? Dia 31 contra um mês de 28, 29 ou 30 dias: não existe, e o mês
  -- anterior vale inteiro (o último dia dele, sem corte de hora), como sempre valeu.
  v_mes_ant_tem_o_dia := v_mes_ant_inicio + (v_hoje - v_mes_inicio) <= v_mes_inicio - 1;
  -- O lucro estimado conta o MÊS INTEIRO (dia 1 até o último dia), previstos inclusos: a conta do "Mês atual"
  -- do Financeiro (20261390000000). Os demais números do mês seguem até hoje. Aritmética de DATA (sem fuso):
  -- primeiro dia + 1 mês - 1 dia = 28/29 em fevereiro, 30 ou 31 nos outros meses.
  v_mes_fim := (v_mes_inicio + interval '1 month')::date - 1;
  v_lucro := (public.fin_dre(v_mes_inicio, v_mes_fim) ->> 'lucro_liquido')::numeric;

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
      -- Hoje só vai até agora: a semana passada também, até a MESMA hora (20261228000000).
      'receita_semana_passada', (SELECT COALESCE(sum(total), 0) FROM v
                                  WHERE dia = v_hoje - 7
                                    AND (pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)
    ),
    'mes', jsonb_build_object(
      'receita', (SELECT COALESCE(sum(total), 0) FROM v WHERE dia BETWEEN v_mes_inicio AND v_hoje),
      -- O mês de hoje só vai até agora: o último dia dos mesmos dias do mês anterior também, até a MESMA hora
      -- (20261398000000), como a semana passada (20261228000000) e o período do CRM (20261232000000).
      'receita_mes_anterior', (SELECT COALESCE(sum(total), 0) FROM v
                                WHERE dia BETWEEN v_mes_ant_inicio AND v_mes_ant_fim
                                  AND (dia < v_mes_ant_fim OR NOT v_mes_ant_tem_o_dia
                                       OR (pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)),
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
      'estoque_baixo', (SELECT count(*)
                          FROM public.produtos p
                          LEFT JOIN LATERAL (
                            SELECT count(*) FILTER (WHERE pv.active) AS qtd_ativas,
                                   sum(COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_ativas
                              FROM public.product_variants pv
                             WHERE pv.product_id = p.id
                          ) v ON true
                         WHERE p.deleted_at IS NULL AND p.ativo = true
                           AND CASE WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_ativas, 0)
                                    ELSE p.estoque END
                               <= COALESCE(p.estoque_minimo, 5))
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

CREATE OR REPLACE FUNCTION public.fin_resumo(p_inicio date, p_fim date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := public.fin__hoje();
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

  WITH periodo AS (
    SELECT * FROM public.fin__movimentos(p_inicio, p_fim) WHERE status = 'realizado'
  ), previstos AS (
    SELECT m.*, COALESCE(m.vencimento, m.data) AS venc
      FROM public.fin__movimentos(NULL, NULL) m WHERE m.status = 'previsto'
  ), saldos AS (
    SELECT c.id, c.nome, c.tipo, c.ativa, c.ordem, round(s.saldo, 2) AS saldo
      FROM public.fin_contas c JOIN public.fin__saldos() s ON s.conta_id = c.id
  )
  SELECT jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_inicio, 'fim', p_fim),
    'saldo_total', COALESCE((SELECT sum(saldo) FROM saldos WHERE ativa), 0),
    'contas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'tipo', tipo, 'saldo', saldo)
                          ORDER BY ordem, nome) FROM saldos WHERE ativa), '[]'::jsonb),
    'entradas', COALESCE((SELECT sum(valor) FROM periodo WHERE tipo = 'entrada'), 0),
    'saidas', COALESCE((SELECT sum(valor) FROM periodo WHERE tipo = 'saida'), 0),
    'resultado', COALESCE((SELECT sum(CASE WHEN tipo = 'entrada' THEN valor WHEN tipo = 'saida' THEN -valor ELSE 0 END)
                           FROM periodo), 0),
    'a_receber', jsonb_build_object(
      'total', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'entrada'), 0),
      'vencido', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'entrada' AND venc < v_hoje), 0),
      'proximos_7_dias', COALESCE((SELECT sum(valor) FROM previstos
                                    WHERE tipo = 'entrada' AND venc BETWEEN v_hoje AND v_hoje + 7), 0)),
    'a_pagar', jsonb_build_object(
      'total', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'saida'), 0),
      'vencido', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'saida' AND venc < v_hoje), 0),
      'proximos_7_dias', COALESCE((SELECT sum(valor) FROM previstos
                                    WHERE tipo = 'saida' AND venc BETWEEN v_hoje AND v_hoje + 7), 0)),
    'por_forma', COALESCE((SELECT jsonb_agg(jsonb_build_object('forma', forma, 'valor', total) ORDER BY total DESC)
                             FROM (SELECT forma_pagamento AS forma, sum(valor) AS total FROM periodo
                                    WHERE origem IN ('venda_online', 'venda_balcao', 'venda_entrega')
                                    GROUP BY forma_pagamento) f), '[]'::jsonb),
    'por_canal', jsonb_build_object(
      'online', COALESCE((SELECT sum(valor) FROM periodo WHERE origem IN ('venda_online', 'venda_entrega')), 0),
      'presencial', COALESCE((SELECT sum(valor) FROM periodo WHERE origem = 'venda_balcao'), 0)),
    'serie', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'dia', d.dia::date,
                 'entradas', COALESCE((SELECT sum(valor) FROM periodo p WHERE p.data = d.dia::date AND p.tipo = 'entrada'), 0),
                 'saidas', COALESCE((SELECT sum(valor) FROM periodo p WHERE p.data = d.dia::date AND p.tipo = 'saida'), 0)
               ) ORDER BY d.dia)
               FROM generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day') AS d(dia)), '[]'::jsonb),
    'caixa_aberto', (SELECT jsonb_build_object('id', s.id, 'conta_id', s.conta_id,
                                               'aberto_em', s.aberto_em, 'valor_abertura', s.valor_abertura)
                       FROM public.fin_caixa_sessoes s WHERE s.status = 'aberto'
                      ORDER BY s.aberto_em DESC LIMIT 1)
  ) INTO v_res;
  RETURN v_res;
END;
$$;

DO $conferencia_rollback_20261399300$
DECLARE
  v_oid oid;
  v_hash text;
  r record;
BEGIN
  FOR r IN
    SELECT esperado.*, split_part(split_part(esperado.assinatura, '.', 2), '(', 1) AS nome
      FROM (VALUES
        ('public.painel_inicio()', '01d29aedf98b7f95851c1a1001b5c7ca'),
        ('public.fin_resumo(date,date)', '410668ed931d89e0a16a568b35df7973')
      ) AS esperado(assinatura, hash_vigente)
  LOOP
    v_oid := to_regprocedure(r.assinatura);
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM r.hash_vigente
       OR NOT EXISTS (SELECT 1 FROM pg_proc p
                       WHERE p.oid = v_oid
                         AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.' || r.nome || '3993_atributos')::jsonb) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261399300 falhou em % (corpo ou atributos alterados).', r.assinatura;
    END IF;
  END LOOP;
END $conferencia_rollback_20261399300$;
