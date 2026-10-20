-- ============================================================================
-- Migration 20261228000000 — o Início compara até a mesma hora
-- (números do painel; caçada de 14/10/2026 em Postgres descartável; só LEITURA)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- O chip de "Vendas pagas hoje" do Início (painel_inicio()->'hoje'->>'receita_semana_passada')
-- comparava o dia de HOJE, que só vai até agora, com o DIA INTEIRO de sete dias atrás. Às 9h,
-- vender no mesmo ritmo da semana passada mostrava "▼ 66% vs. mesmo dia da semana passada" em
-- vermelho (20261212000000, linha do receita_semana_passada). O mês já compara os mesmos dias,
-- e a função antiga do gráfico (get_admin_analytics_v2, 20261214000000) já compara até a mesma
-- hora; só este número ficava de fora.
--
-- 2. A REGRA NOVA
--
-- receita_semana_passada = a receita do mesmo dia da semana passada (hoje - 7) até a MESMA
-- hora de agora, no relógio de America/Sao_Paulo (o fuso fixo que fin__hoje() e fin__dia() já
-- usam). Prova às 06:07: semana passada R$ 100 às 04h e R$ 200 às 18h, hoje R$ 100 às 05h:
-- a base da semana passada é R$ 100 e o chip fica em 0%, não -66,7%. A venda que saiu na
-- semana passada DEPOIS desta hora de hoje não entra na base.
--
-- 3. O QUE ACONTECE EM CADA CASO
--
--   * À meia-noite e um minuto (hora cedo): a base é só o que saiu na semana passada até
--     00:01; sem venda até ali, a base é 0 e o chip some (variação sobre zero não existe).
--   * Fim do dia (23:59): a base é praticamente o dia inteiro — igual a antes.
--   * Venda da semana passada exatamente na hora de agora: entra (<=).
--   * Os outros números do Início (receita de hoje, mês, mês anterior, série de 14 dias,
--     pendências, saldo) não mudam um byte.
--
-- 4. QUEM LÊ
--
-- src/components/admin/inicio/HojeNaLoja.tsx (o chip). Formato do JSON idêntico: só muda o
-- VALOR de hoje.receita_semana_passada. Assinatura, retorno, STABLE, SECURITY DEFINER,
-- search_path e as travas de admin (is_admin e is_admin_atual) iguais.
--
-- 5. DADOS EXISTENTES
--
-- Nenhuma linha é lida para decidir nem reescrita ao aplicar: só o corpo de UMA função muda.
--
-- 6. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se o corpo vivo (md5 de replace(prosrc, E'\r', '')) não for o vigente (o da
-- 20261212000000) nem o que esta migration deixa; se os atributos ou a ACL não forem os
-- conhecidos; ou se faltar função que o corpo lê. Os hashes são o md5 REAL dos corpos,
-- amarrados ao texto por tests/migration_o_inicio_compara_ate_a_mesma_hora_test.ts.
--
-- 7. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- O pré-voo aceita o corpo desta migration; CREATE OR REPLACE com o mesmo texto deixa o
-- mesmo estado. Sem BEGIN/COMMIT de nível superior (regra da casa): o pré-voo, a troca do
-- corpo e a conferência final caem juntos ou não caem.
--
-- 8. ORDEM E ROLLBACK
--
-- Depois da 20261212000000 (o pré-voo recusa sem ela). Independe da 20261227000000 (outra
-- função). ROLLBACK MANUAL: rollback-manual-20261228000000_o_inicio_compara_ate_a_mesma_hora.sql
-- devolve o corpo da 20261212000000 byte a byte. Este rollback vem ANTES do da 20261212000000
-- (o dele recusa enquanto houver redefinição posterior no ar). A 8e (lote 92-202) e a 17a
-- (lote do estoque do painel) aceitam este corpo como sucessor do da 20261212000000.
--
-- 9. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.painel_inicio()');
--      -- esperado: ad5620273997ba9266f240f272bf399b.
--   2. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/numeros-do-painel-viva.cjs (rpc-ci).
-- ============================================================================

DO $preflight_20261228$
DECLARE
  v_fn CONSTANT text := 'public.painel_inicio()';
  v_oid oid := to_regprocedure('public.painel_inicio()');
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
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'painel_inicio') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: painel_inicio tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO: o vigente (o da 20261212000000) (aplica) ou o desta migration (reaplicar é no-op).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.painel_inicio()', 'f11d22d076c59ab54d1beb280954dd15', 'ad5620273997ba9266f240f272bf399b')
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
          AND pg_get_function_arguments(p.oid) = ''
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  -- O PL/pgSQL só acusa coluna ou função ausente na hora de EXECUTAR, não ao criar: confere antes.
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['produtos.estoque_minimo', 'marketplace_orders.paid_at']) AS d(item)
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = to_regclass('public.' || split_part(d.item, '.', 1))
              AND a.attname = split_part(d.item, '.', 2)
              AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: colunas que o corpo novo lê não existem: % — aplique as migrations anteriores antes.', v_falta;
  END IF;
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['public.crm__vendas(timestamptz)', 'public.fin__hoje()', 'public.fin_dre(date,date)', 'public.is_admin()', 'public.is_admin_atual()']) AS d(item)
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
END $preflight_20261228$;

-- painel_inicio: corpo vigente da 20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql,
-- com a semana passada cortada na mesma hora de hoje.
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
DO $conferencia_20261228$
DECLARE
  v_fn CONSTANT text := 'public.painel_inicio()';
  v_oid oid := to_regprocedure('public.painel_inicio()');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261228: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'painel_inicio') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261228: painel_inicio ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'ad5620273997ba9266f240f272bf399b' THEN
    RAISE EXCEPTION 'conferencia 20261228: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = ''
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'conferencia 20261228: atributos de % mudaram', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261228: % alcançável por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261228: anon executa %', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261228: authenticated perdeu EXECUTE em %', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261228: service_role perdeu EXECUTE em %', v_fn;
  END IF;
END $conferencia_20261228$;
