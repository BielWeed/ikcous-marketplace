-- ============================================================================
-- Migration 20261390000000 — o lucro estimado do Início conta o mês inteiro
-- (números do painel; decisão do sócio de 26/10/2026; só LEITURA)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- O cartão "Lucro estimado" do Início (painel_inicio()->'mes'->>'lucro_estimado') somava o resultado do
-- Financeiro só do dia 1 até HOJE (fin_dre(v_mes_inicio, v_hoje), 20261228000000). O "Mês atual" do
-- Financeiro vai do dia 1 ao ÚLTIMO dia do mês (intervaloDoPeriodo/fimDoMes em src/lib/financeiro.ts) e a
-- fin_dre soma a despesa PREVISTA pela data de referência (data_competencia). Resultado: com um aluguel
-- lançado para o dia 28, o Financeiro já descontava no dia 5 e o Início só descontava no dia 28 — dois
-- números diferentes para a mesma pergunta ("quanto sobrou este mês?"). Os textos da tela já descrevem o
-- número certo (AdminDashboardView: "o resultado do Financeiro no mês"; NumerosDoMes: "despesas, mesmo
-- não pagas"; NovoLancamentoFolha: "qualquer dia do mês serve"); só o banco cortava em hoje.
--
-- 2. A REGRA NOVA
--
-- lucro_estimado = fin_dre(primeiro dia do mês, ÚLTIMO dia do mês)->>'lucro_liquido', o mês de referência de
-- hoje no relógio de America/Sao_Paulo (fin__hoje(), o fuso fixo que o resto do painel já usa). O último dia
-- é (primeiro dia + 1 mês)::date - 1, aritmética de DATA pura (sem fuso, sem horário de verão): 28 ou 29 em
-- fevereiro, 30 ou 31 nos outros meses, e a virada de dezembro para janeiro cai certa.
--
-- 3. O QUE ACONTECE EM CADA CASO
--
--   * Despesa PREVISTA com referência no último dia do mês: passa a pesar no lucro desde o dia 1.
--   * Despesa prevista com referência no mês anterior ou no mês seguinte: continua de fora.
--   * Lançamento cancelado: continua de fora (a fin_dre já o ignora).
--   * Dia 1 do mês: o lucro já traz o mês inteiro (despesas do mês), com a receita só do primeiro dia.
--   * Último dia do mês: igual a antes (hoje já é o fim da janela).
--   * MARGEM: a "Margem estimada" do cartão é lucro_estimado / receita do mês (NumerosDoMes.tsx), e a
--     receita do mês continua indo só até hoje. Nos primeiros dias do mês, com despesa prevista do mês
--     inteiro contra poucas vendas, a margem sai muito negativa (ex.: receita R$ 200 e aluguel previsto
--     R$ 3.000 dão lucro -R$ 2.800 e margem de -1400%). É a consequência direta da decisão; nenhuma regra
--     nova foi criada aqui para a margem.
--   * Os OUTROS números do Início não mudam um byte: receita de hoje, receita da semana passada (até a
--     mesma hora), receita, pedidos e ticket médio do mês (até hoje), mês anterior, série de 14 dias,
--     saldo, a receber/a pagar em 7 dias, contas vencidas e pendências.
--
-- 4. QUEM LÊ
--
-- src/lib/crm.ts (mapper) -> src/components/admin/inicio/NumerosDoMes.tsx. Formato do JSON idêntico: só
-- muda o VALOR de mes.lucro_estimado. Assinatura, retorno, STABLE, SECURITY DEFINER, search_path e as
-- travas de admin (is_admin e is_admin_atual) iguais; nenhuma permissão muda.
--
-- 5. DADOS EXISTENTES
--
-- Nenhuma linha é lida para decidir nem reescrita ao aplicar: só o corpo de UMA função muda. Nenhum
-- lançamento, pedido ou categoria é tocado. Aditiva e sem DROP.
--
-- 6. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se o corpo vivo (md5 de replace(prosrc, E'\r', '')) não for o vigente (o da 20261228000000, md5
-- ad5620273997ba9266f240f272bf399b) nem o que esta migration deixa (md5 b4aa318b777824bd49aab4175d9133f8); se os atributos, o dono ou a ACL não forem os
-- conhecidos; ou se faltar função que o corpo lê. Fotografa o registro inteiro de pg_proc (menos o texto) e
-- a conferência final exige que ele seja igual: só o texto muda. Os hashes são o md5 REAL dos corpos,
-- amarrados ao texto por tests/migration_o_lucro_do_inicio_conta_o_mes_inteiro_test.ts.
--
-- 7. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- O pré-voo aceita o corpo desta migration; CREATE OR REPLACE com o mesmo texto deixa o mesmo estado, então
-- rodar duas vezes é inofensivo. Sem BEGIN/COMMIT de nível superior (regra da casa): o aplicador fornece a
-- transação inteira; o pré-voo, a troca do corpo e a conferência final caem juntos ou não caem.
--
-- 8. ORDEM E ROLLBACK
--
-- Depois da 20261228000000 (o pré-voo recusa sem ela). ROLLBACK MANUAL:
-- rollback-manual-20261390000000_o_lucro_do_inicio_conta_o_mes_inteiro.sql devolve o corpo da 20261228000000
-- byte a byte. Este rollback vem ANTES do da 20261228000000 (o dele só aceita o corpo dele).
--
-- 9. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.painel_inicio()');
--      -- esperado: b4aa318b777824bd49aab4175d9133f8.
--   2. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/crm-inicio-viva.cjs, prova (e) (rpc-ci).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261390$
DECLARE
  v_fn CONSTANT text := 'public.painel_inicio()';
  v_oid oid := to_regprocedure('public.painel_inicio()');
  v_hash text;
  v_atributos jsonb;
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
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'painel_inicio') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: painel_inicio tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO: o vigente (o da 20261228000000) (aplica) ou o desta migration (reaplicar é no-op).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.painel_inicio()', 'ad5620273997ba9266f240f272bf399b', 'b4aa318b777824bd49aab4175d9133f8')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos
      FROM pg_proc p
     WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente antes desta migration nem o que ela deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- Atributos que o CREATE OR REPLACE reescreve: têm de ser os de sempre.
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
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos, retorno ou dono) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  -- O PL/pgSQL só acusa função ausente na hora de EXECUTAR, não ao criar: confere antes.
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['public.crm__vendas(timestamptz)', 'public.fin__hoje()', 'public.fin_dre(date,date)', 'public.fin__movimentos(date,date)', 'public.fin__saldos()', 'public.is_admin()', 'public.is_admin_atual()']) AS d(item)
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

  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE só pode trocar prosrc.
  PERFORM set_config('ikcous.inicio390_atributos', v_atributos::text, true);
END $preflight_20261390$;

-- painel_inicio: corpo vigente da 20261228000000_o_inicio_compara_ate_a_mesma_hora.sql, com o lucro estimado
-- contado até o ÚLTIMO dia do mês (v_mes_fim) em vez de até hoje.
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

-- CONFERÊNCIA no instante do apply: aborta se o corpo vivo não é o novo, se algum atributo
-- mudou, ou se a ACL não ficou PUBLIC não, anon não, authenticated sim, service_role sim.
DO $conferencia_20261390$
DECLARE
  v_fn CONSTANT text := 'public.painel_inicio()';
  v_oid oid := to_regprocedure('public.painel_inicio()');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261390: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'painel_inicio') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261390: painel_inicio ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'b4aa318b777824bd49aab4175d9133f8' THEN
    RAISE EXCEPTION 'conferencia 20261390: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p
        WHERE p.oid = v_oid
          AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.inicio390_atributos')::jsonb
     ) THEN
    RAISE EXCEPTION 'conferencia 20261390: atributos de % mudaram (só o texto podia mudar)', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261390: % alcançável por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261390: anon executa %', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261390: authenticated perdeu EXECUTE em %', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261390: service_role perdeu EXECUTE em %', v_fn;
  END IF;
END $conferencia_20261390$;
