-- Rollback manual da 20261399985000. Devolve fin_resumo ao corpo da 20261399300000, byte a byte (LF), mantendo OID, dono, atributos e ACL;
-- nao toca em dados.
-- ATENCAO: reabre o defeito (o grafico do Financeiro volta a somar o movimento das contas desativadas e a nao ter a chave
-- serie[].variacao_saldo). O front novo, sem a chave, cai no calculo de sempre (entradas - saidas): nao precisa voltar.
-- O pre-voo exige o corpo DESTA migration (fin_resumo md5 9e711b03cc63f610461915b850f2eb70): segundo rollback ou sucessora desconhecida recusa, e nada
-- e gravado. Depois dele o corpo e o vigente (md5 a10e7f301eaf6b3edfac50bc87ff74bc, o que o rollback da 20261399300000 exige).
-- Sem controle de transacao: o aplicador fornece a transacao inteira.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261399985$
DECLARE
  v_oid oid;
  v_hash text;
  v_atributos jsonb;
BEGIN
  v_oid := to_regprocedure('public.fin_resumo(date,date)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.fin_resumo(date,date) nao existe.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fin_resumo') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fin_resumo tem sobrecarga em public - revise antes de desfazer.';
  END IF;
  SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
    INTO v_hash, v_atributos FROM pg_proc p
   WHERE p.oid = v_oid;
  IF v_hash IS DISTINCT FROM '9e711b03cc63f610461915b850f2eb70' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fin_resumo (hash %) nao e o corpo desta migration; revise antes de desfazer.', COALESCE(v_hash, 'ausente');
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
     OR pg_get_function_arguments(v_oid) IS DISTINCT FROM 'p_inicio date, p_fim date' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos, dono ou permissoes de fin_resumo diferentes dos esperados.';
  END IF;
  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
  PERFORM set_config('ikcous.fin_resumo39985_atributos', v_atributos::text, true);
END $preflight_rollback_20261399985$;

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

DO $conferencia_rollback_20261399985$
DECLARE
  v_oid oid := to_regprocedure('public.fin_resumo(date,date)');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'a10e7f301eaf6b3edfac50bc87ff74bc'
     OR NOT EXISTS (SELECT 1 FROM pg_proc p
                     WHERE p.oid = v_oid
                       AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.fin_resumo39985_atributos')::jsonb) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261399985 falhou em fin_resumo (corpo ou atributos alterados).';
  END IF;
END $conferencia_rollback_20261399985$;
