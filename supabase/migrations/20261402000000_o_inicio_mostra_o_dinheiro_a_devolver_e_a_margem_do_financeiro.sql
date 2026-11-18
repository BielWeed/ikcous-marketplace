-- ============================================================================
-- Migration 20261402000000 - o Inicio mostra o dinheiro a devolver e a margem do Financeiro
-- (numeros do painel; so LEITURA)
-- ============================================================================
--
-- 1. OS DOIS DEFEITOS
--
-- (a) Um pedido PAGO e CANCELADO sem devolucao fica fora de "Vendas pagas" do Inicio e do CRM (R$ 0), mas dentro do Financeiro (R$ 100):
-- os dois numeros estao certos e a diferenca nao tinha nome nem aviso. O Inicio nao mostrava o dinheiro que a lojista ainda deve ao cliente.
-- (b) A "Margem estimada" do Inicio dividia o lucro do mes pela receita BRUTA (a de "Vendas pagas"), enquanto a "Margem liquida" do
-- Financeiro divide o mesmo lucro pela receita LIQUIDA (vendas menos estornos e devolucoes): a mesma loja, o mesmo mes, dois percentuais.
--
-- 2. A REGRA NOVA, SO ISTO (painel_inicio ganha duas chaves; nenhuma existente muda)
--
--   * 'dinheiro_a_devolver' = {valor (reais, numeric), pedidos (inteiro)}: a MESMA conta da lista "Devolver agora" da tela de Pedidos
--     (src/views/admin/AdminOrdersView.tsx baldeDeEstorno; src/lib/valor-devolver-agora.ts; src/hooks/useEstornosEmCursoDosPedidos.ts),
--     em centavos inteiros:
--       - entra o pedido status = 'cancelled' cujo pagamento ENTROU (payment_status pago, pago_apos_expirar ou recebido_na_entrega);
--       - sai o que foi para a entrega e o produto ainda nao voltou (cancelled_after_shipping E returned_to_seller_at nulo: espera o produto);
--       - o valor e' total - reembolso manual de devolucao CONCLUIDA (devolucoes.valor_reembolso, status 'concluida', reembolso_manual)
--         - valor_estornado; so entra se for maior que zero;
--       - menos o que o Mercado Pago JA esta devolvendo (order_refunds solicitado ou em_processamento) e o que ele concluiu alem do retrato
--         do pedido (concluido - valor_estornado, nunca negativo). O pedido cujo resto fica em zero (devolucao toda em andamento) FICA FORA:
--         a lojista nao tem gesto a fazer. Linha falhou/recusado nao conta.
--     SEM janela de datas: dinheiro que a lojista deve ao cliente nao envelhece. A lista de Pedidos recorta 90 dias e avisa dos antigos.
--   * 'mes.receita_liquida': a receita liquida que o fin_dre ja devolve junto do lucro, no MESMO periodo do lucro_estimado (o mes inteiro).
--     O front calcula a margem como lucro / receita liquida, como o Financeiro. A leitura do fin_dre passa a ser UMA so (v_dre).
--
-- 3. O QUE NAO MUDA (de proposito)
--
--   * A regra de "venda" (Vendas pagas, crm__vendas) NAO muda; o pedido cancelado continua fora dela.
--   * Todas as chaves que painel_inicio ja devolvia, o lucro_estimado (mesma conta), a assinatura, o retorno jsonb, STABLE, SECURITY DEFINER,
--     o search_path, as duas travas de admin (is_admin e is_admin_atual), o dono e as permissoes (nenhum GRANT/REVOKE).
--
-- 4. DADOS EXISTENTES E QUEM LE
--
-- Nenhuma linha e escrita nem reescrita: so o corpo de UMA funcao muda (CREATE OR REPLACE). Pedido, devolucao e estorno nao sao tocados. A
-- leitura nova percorre so os pedidos cancelados e pagos (indices de status e de order_id existem em devolucoes e order_refunds). Quem le:
-- src/lib/crm.ts (lerPainelInicio) -> Inicio (ParaFazer, NumerosDoMes). Front novo com banco velho: as chaves vem ausentes, o parser devolve
-- "nao sei" e a tela cai no comportamento de antes sem erro (publicar o banco ANTES do front).
--
-- 5. PRE-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se o corpo vivo (md5 de replace(prosrc, E'\r', '')) nao for o vigente (o da 20261399300000, md5 8d58e15e7410afe0d254f37f38251df4) nem o que esta
-- migration deixa (md5 b4c3665bd806ae8fe8960e5f6d9dde29); se os atributos, o dono ou a ACL nao forem os conhecidos; se houver sobrecarga em public; se faltar
-- funcao, tabela ou coluna que o corpo le; ou se o fin_dre vivo nao devolver as chaves lucro_liquido e receita_liquida. Fotografa o registro
-- de pg_proc (menos o texto) e a conferencia final exige que seja igual: so o texto muda.
--
-- 6. IDEMPOTENCIA E TRANSACAO
--
-- O pre-voo aceita o corpo desta migration; CREATE OR REPLACE com o mesmo texto deixa o mesmo estado, entao rodar duas vezes e inofensivo.
-- Sem BEGIN/COMMIT de nivel superior (regra da casa, AGENTS.md: com eles o ROLLBACK da prova viraria no-op): o aplicador fornece a
-- transacao inteira; pre-voo, troca de corpo e conferencia caem juntos ou nao caem. Aditiva e sem DROP.
--
-- 7. ORDEM E ROLLBACK
--
-- Depois da 20261399300000 (o pre-voo recusa uma loja em outro corpo). Banco ANTES do front. ROLLBACK MANUAL:
-- rollback-manual-20261402000000_o_inicio_mostra_o_dinheiro_a_devolver_e_a_margem_do_financeiro.sql devolve o corpo da 20261399300000 byte a
-- byte. Este rollback vem ANTES do da 20261399300000 (o dele so aceita o corpo dele).
--
-- 8. FICHA DE VERIFICACAO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.painel_inicio()');
--      -- esperado: b4c3665bd806ae8fe8960e5f6d9dde29.
--   2. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/o-inicio-dinheiro-a-devolver-viva.cjs (rpc-ci).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261402$
DECLARE
  v_oid oid;
  v_hash text;
  v_atributos jsonb;
  v_public boolean;
  v_anon boolean;
  v_auth boolean;
  v_servico boolean;
  v_falta text;
  v_hash_vigente text;
  v_hash_desta text;
BEGIN
  v_oid := to_regprocedure('public.painel_inicio()');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.painel_inicio() nao existe.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'painel_inicio') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: painel_inicio tem sobrecarga em public - meca a loja e revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEUDO: o vigente (aplica) ou o desta migration (reaplicar e no-op).
  SELECT esperado.hash_vigente, esperado.hash_desta INTO v_hash_vigente, v_hash_desta
    FROM (VALUES ('public.painel_inicio()', '8d58e15e7410afe0d254f37f38251df4', 'b4c3665bd806ae8fe8960e5f6d9dde29')) AS esperado(assinatura, hash_vigente, hash_desta);
  SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
    INTO v_hash, v_atributos
    FROM pg_proc p
   WHERE p.oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN (v_hash_vigente, v_hash_desta) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de painel_inicio (hash %) nao e o vigente antes desta migration nem o que ela deixa - capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
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
     OR pg_get_function_arguments(v_oid) IS DISTINCT FROM '' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de painel_inicio (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos, retorno ou dono) nao sao os conhecidos - meca a loja e revise antes de aplicar.';
  END IF;

  -- ACL: ninguem de PUBLIC nem anon; o admin logado (authenticated) e o service_role executam.
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
  v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  v_servico := has_function_privilege('service_role', v_oid, 'EXECUTE');
  IF NOT (NOT v_public AND NOT v_anon AND v_auth AND v_servico) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de painel_inicio nao e a conhecida (PUBLIC=%, anon=%, authenticated=%, service_role=%) - meca a loja e revise.', v_public, v_anon, v_auth, v_servico;
  END IF;

  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
  PERFORM set_config('ikcous.painel_inicio14020_atributos', v_atributos::text, true);

  -- O PL/pgSQL so acusa funcao ausente na hora de EXECUTAR, nao ao criar: confere antes.
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['public.crm__vendas(timestamptz)', 'public.fin__hoje()', 'public.fin_dre(date,date)', 'public.fin__movimentos(date,date)', 'public.fin__saldos()', 'public.is_admin()', 'public.is_admin_atual()']) AS d(item)
   WHERE to_regprocedure(d.item) IS NULL;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: funcoes que o corpo novo chama nao existem: % - aplique as migrations anteriores antes.', v_falta;
  END IF;
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['public.fin_contas', 'public.fin_caixa_sessoes', 'public.marketplace_orders', 'public.devolucoes', 'public.order_refunds', 'public.produtos', 'public.product_variants']) AS d(item)
   WHERE to_regclass(d.item) IS NULL;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: tabelas que o corpo novo le nao existem: % - aplique as migrations anteriores antes.', v_falta;
  END IF;
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['marketplace_orders.status', 'marketplace_orders.payment_status', 'marketplace_orders.total', 'marketplace_orders.valor_estornado',
                      'marketplace_orders.cancelled_after_shipping', 'marketplace_orders.returned_to_seller_at',
                      'devolucoes.order_id', 'devolucoes.status', 'devolucoes.valor_reembolso', 'devolucoes.reembolso_manual',
                      'order_refunds.order_id', 'order_refunds.status', 'order_refunds.amount']) AS d(item)
   WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = to_regclass('public.' || split_part(d.item, '.', 1))
                        AND a.attname = split_part(d.item, '.', 2) AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: colunas que o corpo novo le nao existem: % - aplique as migrations anteriores antes.', v_falta;
  END IF;

  -- O corpo novo le receita_liquida do fin_dre vivo: o fin_dre tem de devolver as duas chaves (o lucro que o Inicio ja lia e a receita liquida).
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.fin_dre(date,date)')
                    AND position('''lucro_liquido''' IN p.prosrc) > 0
                    AND position('''receita_liquida''' IN p.prosrc) > 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o fin_dre vivo nao devolve lucro_liquido e receita_liquida - o corpo novo depende dessas chaves.';
  END IF;
END $preflight_20261402$;

-- painel_inicio: corpo vigente da 20261399300000_o_estorno_em_andamento_nao_e_conta_vencida.sql, com 'dinheiro_a_devolver' e 'mes.receita_liquida'.
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
  v_receita_liquida numeric;
  v_dre jsonb;
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
  -- Uma leitura so do resultado do mes (fin_dre): o lucro e a receita LIQUIDA do MESMO periodo. A margem do Inicio e' o lucro dividido
  -- pela receita liquida, como a "Margem liquida" do Financeiro (20261402000000).
  v_dre := public.fin_dre(v_mes_inicio, v_mes_fim);
  v_lucro := (v_dre ->> 'lucro_liquido')::numeric;
  v_receita_liquida := (v_dre ->> 'receita_liquida')::numeric;

  WITH v AS (
    SELECT * FROM public.crm__vendas(now()) WHERE dia >= v_mes_ant_inicio - 14
  ), prev AS (
    SELECT m.*, COALESCE(m.vencimento, m.data) AS venc
      FROM public.fin__movimentos(NULL, NULL) m WHERE m.status = 'previsto'
  ), a_devolver AS (
    -- Dinheiro a devolver: a MESMA conta da lista "Devolver agora" da tela de Pedidos (baldeDeEstorno, valorDevolverAgora e
    -- valorDevolverAgoraDescontandoLedger em src/), em centavos inteiros (20261402000000).
    --   * balde: pedido CANCELADO cujo pagamento ENTROU (pago, pago_apos_expirar, recebido_na_entrega), fora o que saiu para a entrega e o
    --     produto ainda nao voltou (esse espera o produto); sobra total - reembolso manual de devolucao concluida - valor_estornado > 0;
    --   * menos o que o Mercado Pago ja esta devolvendo (order_refunds solicitado/em_processamento) e o que concluiu alem do retrato do pedido
    --     (concluido - valor_estornado, nunca negativo). Pedido sem nada a fazer pela lojista (resto 0) fica FORA.
    SELECT GREATEST(b.centavos - COALESCE(l.em_curso, 0) - GREATEST(COALESCE(l.concluido, 0) - b.estornado, 0), 0) AS resto
      FROM (
        SELECT o.id,
               GREATEST(round(COALESCE(o.total, 0) * 100) - round(COALESCE(dm.valor, 0) * 100) - round(COALESCE(o.valor_estornado, 0) * 100), 0) AS centavos,
               round(COALESCE(o.valor_estornado, 0) * 100) AS estornado
          FROM public.marketplace_orders o
          LEFT JOIN LATERAL (
            SELECT sum(dv.valor_reembolso) AS valor
              FROM public.devolucoes dv
             WHERE dv.order_id = o.id AND dv.status = 'concluida' AND dv.reembolso_manual
          ) dm ON true
         WHERE o.status = 'cancelled'
           AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
           AND NOT (COALESCE(o.cancelled_after_shipping, false) AND o.returned_to_seller_at IS NULL)
      ) b
      LEFT JOIN LATERAL (
        SELECT sum(round(r.amount * 100)) FILTER (WHERE r.status IN ('solicitado', 'em_processamento')) AS em_curso,
               sum(round(r.amount * 100)) FILTER (WHERE r.status = 'concluido') AS concluido
          FROM public.order_refunds r
         WHERE r.order_id = b.id
           AND r.status IN ('solicitado', 'em_processamento', 'concluido')
           AND round(r.amount * 100) > 0
      ) l ON true
     WHERE b.centavos > 0
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
      'lucro_estimado', v_lucro,
      'receita_liquida', v_receita_liquida
    ),
    'saldo_total', (SELECT COALESCE(round(sum(s.saldo), 2), 0)
                      FROM public.fin__saldos() s JOIN public.fin_contas c ON c.id = s.conta_id WHERE c.ativa),
    'a_receber_7d', (SELECT COALESCE(sum(valor), 0) FROM prev WHERE tipo = 'entrada' AND venc <= v_hoje + 7),
    'a_pagar_7d', (SELECT COALESCE(sum(valor), 0) FROM prev WHERE tipo = 'saida' AND venc <= v_hoje + 7),
    -- Estorno em andamento (origem 'estorno': o reembolso que o Mercado Pago ainda esta concluindo) nao e conta a pagar e sai da
    -- conta sozinho: nao conta como conta vencida (20261399300000). A conta que a lojista lancou segue contando.
    'contas_vencidas', (SELECT count(*) FROM prev WHERE tipo = 'saida' AND venc < v_hoje AND origem <> 'estorno'),
    -- Dinheiro a devolver (20261402000000): valor em reais e quantidade de pedidos cancelados que ainda dependem da lojista.
    'dinheiro_a_devolver', jsonb_build_object(
      'valor', (SELECT COALESCE(round(sum(resto) / 100, 2), 0) FROM a_devolver WHERE resto > 0),
      'pedidos', (SELECT count(*) FROM a_devolver WHERE resto > 0)
    ),
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

-- CONFERENCIA no instante do apply: aborta se o corpo vivo nao e o novo, se algum atributo mudou, ou se a ACL abriu para PUBLIC ou anon ou o
-- authenticated perdeu o EXECUTE.
DO $conferencia_20261402$
DECLARE
  v_oid oid;
  v_hash text;
BEGIN
  v_oid := to_regprocedure('public.painel_inicio()');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261402: painel_inicio sumiu';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'painel_inicio') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261402: painel_inicio ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'b4c3665bd806ae8fe8960e5f6d9dde29' THEN
    RAISE EXCEPTION 'conferencia 20261402: corpo vivo de painel_inicio (hash %) nao e o desta migration', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p
        WHERE p.oid = v_oid
          AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.painel_inicio14020_atributos')::jsonb
     ) THEN
    RAISE EXCEPTION 'conferencia 20261402: atributos de painel_inicio mudaram (so o texto podia mudar)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261402: painel_inicio alcancavel por PUBLIC';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261402: anon executa painel_inicio';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261402: authenticated perdeu EXECUTE em painel_inicio';
  END IF;
END $conferencia_20261402$;
