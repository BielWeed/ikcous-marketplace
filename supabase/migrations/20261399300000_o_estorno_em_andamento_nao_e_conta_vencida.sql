-- ============================================================================
-- Migration 20261399300000 - o estorno em andamento nao e conta vencida
-- (numeros do painel; rodada 7 de 04/11/2026; so LEITURA)
-- ============================================================================
--
-- 1. O DEFEITO
--
-- O lojista devolve o dinheiro de um pedido pelo app. Enquanto o Mercado Pago conclui o reembolso, o Financeiro mostra essa saida como
-- PREVISTA (fin__movimentos: order_refunds 'solicitado' ou 'em_processamento' vira a linha origem 'estorno', tipo 'saida', status
-- 'previsto', com vencimento no dia em que o pedido de estorno foi criado). A partir do dia seguinte esse vencimento fica no passado e o
-- Inicio passa a mostrar "1 conta vencida" em vermelho, com o botao "Pagar em Financeiro" (painel_inicio -> contas_vencidas). A lojista
-- procura uma conta para pagar e acha so o estorno, que nao tem acao: a propria aba "Pagar e receber" diz "sai da conta sozinho quando o
-- Mercado Pago concluir". A Visao do Financeiro tinha o mesmo defeito no "Vencido" de "A pagar" (fin_resumo -> a_pagar.vencido): as duas
-- telas leem a mesma fonte (os movimentos previstos de fin__movimentos) e tem de concordar.
--
-- 2. A REGRA NOVA, SO ISTO
--
-- Duas funcoes, a mesma condicao: movimento previsto de origem 'estorno' NAO conta como vencido.
--   * painel_inicio():  'contas_vencidas' = count(*) dos previstos de SAIDA com vencimento antes de hoje, AND origem <> 'estorno'.
--   * fin_resumo():     a_pagar.vencido   = soma  dos previstos de SAIDA com vencimento antes de hoje, AND origem <> 'estorno'.
-- A conta lancada pela lojista (origem manual, sangria, suprimento, ajuste de caixa: o CHECK de fin_lancamentos.origem) segue contando
-- exatamente como antes; so o estorno em andamento sai. estorno_externo e devolucao nascem 'realizado' e nunca entram nos previstos.
--
-- 3. O QUE NAO MUDA (de proposito)
--
--   * painel_inicio -> a_pagar_7d e a_receber_7d: ficam como estao (decisao desta rodada: o numero de "A pagar" do cartao do Inicio
--     segue somando o estorno previsto; so o alarme de "conta vencida" sai). Por isso o cartao pode mostrar um valor a pagar sem nenhuma
--     conta vencida enquanto houver estorno em andamento: e' o previsto, nao a conta atrasada.
--   * fin_resumo -> a_pagar.total e a_pagar.proximos_7_dias: ficam (so o "vencido" muda). O total continua incluindo o estorno previsto.
--   * fin__movimentos e a aba "Pagar e receber" (fin_previstos): o estorno segue listado la, com a nota de que sai sozinho.
--   * O resto do JSON de painel_inicio e de fin_resumo, as chaves, as travas de admin (is_admin e is_admin_atual), a assinatura, o
--     retorno, STABLE, SECURITY DEFINER, o search_path e as permissoes (nenhum GRANT/REVOKE).
--
-- 4. DADOS EXISTENTES E QUEM LE
--
-- Nenhuma linha e lida para decidir nem reescrita ao aplicar: so o corpo de DUAS funcoes muda. Pedido, estorno e lancamento nao sao
-- tocados. O numero de uma tela aberta so muda na proxima leitura do painel. Leem: src/lib/crm.ts (Inicio: ParaFazer e
-- DinheiroNasContas) e src/lib/financeiro.ts (Financeiro: AbaVisao). O front nao muda.
--
-- 5. PRE-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Para CADA funcao: recusa se o corpo vivo (md5 de replace(prosrc, E'\r', '')) nao for o vigente (painel_inicio: o da 20261398000000,
-- md5 01d29aedf98b7f95851c1a1001b5c7ca; fin_resumo: o da 20261199000000, md5 410668ed931d89e0a16a568b35df7973) nem o que esta migration deixa (painel_inicio
-- 8d58e15e7410afe0d254f37f38251df4; fin_resumo a10e7f301eaf6b3edfac50bc87ff74bc); se os atributos, o dono ou a ACL nao forem os conhecidos; se houver sobrecarga em public;
-- ou se faltar objeto que os corpos leem. Fotografa o registro inteiro de pg_proc (menos o texto) de cada uma e a conferencia final exige
-- que seja igual: so o texto muda. Os hashes sao o md5 REAL dos corpos, amarrados ao texto por
-- tests/migration_o_estorno_em_andamento_nao_e_conta_vencida_test.ts.
--
-- 6. IDEMPOTENCIA E TRANSACAO
--
-- O pre-voo aceita o corpo desta migration; CREATE OR REPLACE com o mesmo texto deixa o mesmo estado, entao rodar duas vezes e
-- inofensivo. Sem BEGIN/COMMIT de nivel superior (regra da casa, AGENTS.md): o aplicador fornece a transacao inteira; o pre-voo, as duas
-- trocas de corpo e a conferencia final caem juntos ou nao caem. Aditiva e sem DROP.
--
-- 7. ORDEM E ROLLBACK
--
-- Depois da 20261398000000 (painel_inicio) e da 20261199000000 (fin_resumo): o pre-voo recusa uma loja ainda em outro corpo.
-- ROLLBACK MANUAL: rollback-manual-20261399300000_o_estorno_em_andamento_nao_e_conta_vencida.sql devolve OS DOIS corpos byte a byte
-- (painel_inicio da 20261398000000, fin_resumo da 20261199000000). Este rollback vem ANTES do da 20261398000000 e do da 20261199000000
-- (os deles so aceitam o corpo deles).
--
-- 8. FICHA DE VERIFICACAO
--
--   1. SELECT proname, md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid IN (to_regprocedure('public.painel_inicio()'), to_regprocedure('public.fin_resumo(date,date)'));
--      -- esperado: painel_inicio 8d58e15e7410afe0d254f37f38251df4; fin_resumo a10e7f301eaf6b3edfac50bc87ff74bc.
--   2. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/o-estorno-em-andamento-nao-e-conta-vencida-viva.cjs (rpc-ci).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399300$
DECLARE
  v_oid oid;
  v_hash text;
  v_atributos jsonb;
  v_public boolean;
  v_anon boolean;
  v_auth boolean;
  v_servico boolean;
  v_falta text;
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
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public - meca a loja e revise antes de aplicar.', r.nome;
    END IF;

    -- Corpo identificado pelo CONTEUDO: o vigente (aplica) ou o desta migration (reaplicar e no-op).
    SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos
      FROM pg_proc p
     WHERE p.oid = v_oid;
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) nao e o vigente antes desta migration nem o que ela deixa - capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;

    -- Atributos que o CREATE OR REPLACE reescreve: tem de ser os de sempre.
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
       )
       OR pg_get_function_arguments(v_oid) IS DISTINCT FROM (CASE r.nome WHEN 'painel_inicio' THEN '' ELSE 'p_inicio date, p_fim date' END) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos, retorno ou dono) nao sao os conhecidos - meca a loja e revise antes de aplicar.', r.assinatura;
    END IF;

    -- ACL: ninguem de PUBLIC nem anon, o admin logado (authenticated) executa. O service_role de painel_inicio tambem (medido na 20261398);
    -- o de fin_resumo nao e exigido (a ACL inteira, service_role inclusa, entra na fotografia e tem de ficar igual).
    v_public := EXISTS (SELECT 1 FROM pg_proc p
                          CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                         WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
    v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
    v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
    v_servico := has_function_privilege('service_role', v_oid, 'EXECUTE');
    IF NOT (NOT v_public AND NOT v_anon AND v_auth AND (v_servico OR r.nome <> 'painel_inicio')) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % nao e a conhecida (PUBLIC=%, anon=%, authenticated=%, service_role=%) - meca a loja e revise.', r.assinatura, v_public, v_anon, v_auth, v_servico;
    END IF;

    -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
    PERFORM set_config('ikcous.' || r.nome || '3993_atributos', v_atributos::text, true);
  END LOOP;

  -- O PL/pgSQL so acusa funcao ausente na hora de EXECUTAR, nao ao criar: confere antes.
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['public.crm__vendas(timestamptz)', 'public.fin__hoje()', 'public.fin_dre(date,date)', 'public.fin__movimentos(date,date)', 'public.fin__saldos()', 'public.is_admin()', 'public.is_admin_atual()']) AS d(item)
   WHERE to_regprocedure(d.item) IS NULL;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: funcoes que os corpos novos chamam nao existem: % - aplique as migrations anteriores antes.', v_falta;
  END IF;
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['public.fin_contas', 'public.fin_caixa_sessoes', 'public.marketplace_orders', 'public.devolucoes', 'public.produtos', 'public.product_variants']) AS d(item)
   WHERE to_regclass(d.item) IS NULL;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: tabelas que os corpos novos leem nao existem: % - aplique as migrations anteriores antes.', v_falta;
  END IF;
END $preflight_20261399300$;

-- painel_inicio: corpo vigente da 20261398000000_o_inicio_compara_o_mes_anterior_ate_a_mesma_hora.sql, com o estorno em andamento fora
-- de contas_vencidas.
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
    -- Estorno em andamento (origem 'estorno': o reembolso que o Mercado Pago ainda esta concluindo) nao e conta a pagar e sai da
    -- conta sozinho: nao conta como conta vencida (20261399300000). A conta que a lojista lancou segue contando.
    'contas_vencidas', (SELECT count(*) FROM prev WHERE tipo = 'saida' AND venc < v_hoje AND origem <> 'estorno'),
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

-- fin_resumo: corpo vigente da 20261199000000_portas_do_painel_exigem_admin_atual.sql, com o estorno em andamento fora de a_pagar.vencido.
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
      -- Estorno em andamento nao e conta a pagar: fora do vencido, como em painel_inicio.contas_vencidas (20261399300000).
      'vencido', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'saida' AND venc < v_hoje AND origem <> 'estorno'), 0),
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

-- CONFERENCIA no instante do apply: aborta se algum corpo vivo nao e o novo, se algum atributo mudou, ou se a ACL abriu para
-- PUBLIC ou anon ou o authenticated perdeu o EXECUTE.
DO $conferencia_20261399300$
DECLARE
  v_oid oid;
  v_hash text;
  r record;
BEGIN
  FOR r IN
    SELECT esperado.*, split_part(split_part(esperado.assinatura, '.', 2), '(', 1) AS nome
      FROM (VALUES
        ('public.painel_inicio()', '8d58e15e7410afe0d254f37f38251df4'),
        ('public.fin_resumo(date,date)', 'a10e7f301eaf6b3edfac50bc87ff74bc')
      ) AS esperado(assinatura, hash_desta)
  LOOP
    v_oid := to_regprocedure(r.assinatura);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'conferencia 20261399300: % sumiu', r.assinatura;
    END IF;
    IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.nome) <> 1 THEN
      RAISE EXCEPTION 'conferencia 20261399300: % ficou com sobrecarga', r.nome;
    END IF;
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'conferencia 20261399300: corpo vivo de % (hash %) nao e o desta migration', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM pg_proc p
          WHERE p.oid = v_oid
            AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.' || r.nome || '3993_atributos')::jsonb
       ) THEN
      RAISE EXCEPTION 'conferencia 20261399300: atributos de % mudaram (so o texto podia mudar)', r.assinatura;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
      RAISE EXCEPTION 'conferencia 20261399300: % alcancavel por PUBLIC', r.assinatura;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'conferencia 20261399300: anon executa %', r.assinatura;
    END IF;
    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'conferencia 20261399300: authenticated perdeu EXECUTE em %', r.assinatura;
    END IF;
  END LOOP;
END $conferencia_20261399300$;
