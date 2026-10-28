-- ============================================================================
-- Rollback manual — o Início compara o mês anterior até a mesma hora (20261398000000)
-- ============================================================================
-- Devolve, byte a byte, o corpo de public.painel_inicio() que a
-- 20261390000000_o_lucro_do_inicio_conta_o_mes_inteiro.sql deixou (md5 b4aa318b777824bd49aab4175d9133f8): o último dia dos
-- "mesmos dias do mês anterior" volta a contar o dia INTEIRO, sem corte na hora de agora. ATENÇÃO: reabre o
-- defeito do começo do dia e do mês (a seta vermelha por comparar poucas horas de hoje com o dia todo do
-- mês anterior). Mesma assinatura, mesmo STABLE SECURITY DEFINER, mesmo search_path, mesma ACL (CREATE OR
-- REPLACE preserva a vigente); nada é apagado.
--
-- ORDEM: este rollback vem ANTES do rollback da 20261390000000 (o dele só aceita o corpo dele).
--
-- DADOS: a migration não gravou nada em linha nenhuma; não há dado a desfazer.
--
-- PRÉ-VOO: o bloco DO $preflight_rollback_20261398$ recusa com B1_BASELINE_DIVERGENT — ANTES de
-- qualquer escrita — se o corpo VIVO (md5 de replace(prosrc, E'\r', '')) não for exatamente o
-- que a 20261398000000 deixou (md5 01d29aedf98b7f95851c1a1001b5c7ca): segundo rollback ou sucessora desconhecida recusa.
-- Atributos, dono e ACL também são conferidos, e o registro inteiro de pg_proc (menos o texto) é
-- fotografado: a conferência final exige que ele seja igual.
--
-- Executar via psql -1 -f (nunca pelo db-apply, que registraria este rollback no
-- ledger como migration nova). Sem BEGIN/COMMIT de nível superior neste arquivo.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261398$
DECLARE
  v_fn CONSTANT text := 'public.painel_inicio()';
  v_oid oid := to_regprocedure('public.painel_inicio()');
  v_hash text;
  v_atributos jsonb;
  r record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'painel_inicio') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: painel_inicio tem sobrecarga em public — revise antes de desfazer.';
  END IF;
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.painel_inicio()', 'b4aa318b777824bd49aab4175d9133f8', '01d29aedf98b7f95851c1a1001b5c7ca')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos
      FROM pg_proc p
     WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o que a 20261398000000 deixou — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prokind = 'f'
          AND p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = ''
          AND pg_get_function_result(p.oid) = 'jsonb'
          AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND has_function_privilege('service_role', p.oid, 'EXECUTE')
          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                           WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos, dono ou permissões de % diferentes dos esperados.', v_fn;
  END IF;
  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE só pode trocar prosrc.
  PERFORM set_config('ikcous.inicio398_atributos', v_atributos::text, true);
END $preflight_rollback_20261398$;

-- painel_inicio: corpo vigente da 20261390000000_o_lucro_do_inicio_conta_o_mes_inteiro.sql.
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

DO $conferencia_rollback_20261398$
DECLARE
  v_fn CONSTANT text := 'public.painel_inicio()';
  v_oid oid := to_regprocedure('public.painel_inicio()');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia do rollback 20261398: % sumiu', v_fn;
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'b4aa318b777824bd49aab4175d9133f8' THEN
    RAISE EXCEPTION 'conferencia do rollback 20261398: corpo vivo de % (hash %) não é o da 20261390000000', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p
        WHERE p.oid = v_oid
          AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.inicio398_atributos')::jsonb
     ) THEN
    RAISE EXCEPTION 'conferencia do rollback 20261398: atributos de % mudaram (só o texto podia mudar)', v_fn;
  END IF;
END $conferencia_rollback_20261398$;
