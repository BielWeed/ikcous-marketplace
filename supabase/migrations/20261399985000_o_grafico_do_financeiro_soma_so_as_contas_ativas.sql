-- ============================================================================
-- Migration 20261399985000 - o grafico do Financeiro soma so as contas ativas
-- (dinheiro mostrado no painel; so LEITURA; troca o corpo de UMA funcao: fin_resumo)
-- ============================================================================
--
-- 1. O DEFEITO
--
-- A Visao do Financeiro desenha o "saldo ao fim de cada dia" dos ultimos dias. O app NAO recebe esse saldo pronto: ele parte do saldo de
-- HOJE (fin_resumo -> saldo_total, que soma so as contas ATIVAS) e volta dia a dia descontando o que entrou e saiu depois
-- (src/lib/financeiro.ts, serieDoFluxoDeCaixa: saldo do dia = saldo de hoje - soma de (entradas - saidas) dos dias seguintes).
-- Mas fin_resumo -> serie[].entradas e serie[].saidas somam o movimento de TODAS as contas, tambem das desativadas, e nao olham o
-- saldo_inicial_em de cada conta nem as transferencias. Resultado: a lojista desativa uma conta que ja teve movimento e o grafico passa a
-- mostrar, nos dias antes do movimento dela, um saldo que nunca existiu (medido num Postgres efemero, conta desativada com uma saida de
-- 300: o grafico mostrava 400 num dia em que o saldo de verdade das contas ativas era 100). O numero grande do topo (saldo_total) estava
-- certo; o grafico divergia dele.
--
-- 2. A REGRA NOVA, SO ISTO
--
-- fin_resumo -> serie[] ganha UMA chave por dia: variacao_saldo = quanto o saldo das contas ATIVAS mudou naquele dia, pela MESMA conta de
-- fin__saldos (que e o saldo_total): so movimento realizado a partir do saldo_inicial_em de cada conta e ate hoje; entrada soma, saida
-- subtrai, transferencia subtrai da conta de origem e soma na de destino (entre duas contas ativas nao muda nada; de uma ativa para uma
-- desativada e' saida; de uma desativada para uma ativa e' entrada). Com ela, saldo_total - soma(variacao_saldo dos dias seguintes) e'
-- EXATAMENTE o saldo que fin__saldos daria no fim daquele dia (provado dia a dia na prova viva). O front
-- que ainda nao a le segue desenhando como sempre (entradas - saidas) ate trocar.
--
-- 3. O QUE NAO MUDA (de proposito)
--
--   * serie[].dia, serie[].entradas e serie[].saidas: continuam somando TODAS as contas (sao as barras do grafico e o fluxo da loja:
--     o dinheiro que entrou e saiu no periodo, nao o saldo). Cada outra chave do JSON (saldo_total, contas, entradas, saidas, resultado,
--     a_receber, a_pagar, por_forma, por_canal, caixa_aberto) sai identica ao corpo anterior na mesma base (provado).
--   * Assinatura, retorno (jsonb), STABLE, SECURITY DEFINER, search_path, dono, OID e a ACL: nenhum GRANT/REVOKE. As travas de admin
--     (is_admin e is_admin_atual) e a validacao do periodo seguem como estavam, antes de qualquer leitura.
--   * Dinheiro em numeric, nunca em ponto flutuante.
--
-- 4. DADOS EXISTENTES E QUEM LE
--
-- Nenhuma linha e lida para decidir nem reescrita ao aplicar: so o corpo de UMA funcao muda (catalogo). Conta, lancamento, pedido e
-- estorno nao sao tocados; so a LEITURA ganha a chave nova. O numero de uma tela aberta so muda na proxima leitura. Le: src/lib/financeiro.ts
-- (parser do resumo e serieDoFluxoDeCaixa) pelo AbaVisao; o front de hoje ignora chave que nao conhece, entao aplicar o banco ANTES do front
-- e' seguro e e' a ordem certa (o front novo usa a chave quando ela existe e, sem ela, cai no calculo de sempre).
--
-- 5. PRE-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: fin_resumo nao existir ou tiver sobrecarga em public; o corpo vivo (md5 de replace(prosrc, E'\r', '')) nao for o vigente
-- (o da 20261399300000, md5 a10e7f301eaf6b3edfac50bc87ff74bc) nem o que esta migration deixa (md5 9e711b03cc63f610461915b850f2eb70); os atributos, o dono ou a
-- ACL nao forem os conhecidos; fin__saldos (cuja conta esta migration repete) nao estiver no corpo conhecido (md5 5992ecf164d886110c21dbf93a5c607e):
-- com outro corpo o "saldo ao fim do dia" deixaria de bater com o saldo_total, entao a migration PARA em vez de gravar um grafico que mente;
-- ou se faltar objeto que o corpo novo le (colunas ativa e saldo_inicial_em de fin_contas, colunas de fin__movimentos, as funcoes chamadas).
-- Fotografa o registro inteiro de pg_proc (menos o texto) e a conferencia final exige que seja igual: so o texto muda.
--
-- 6. IDEMPOTENCIA E TRANSACAO
--
-- O pre-voo aceita o corpo desta migration; CREATE OR REPLACE com o mesmo texto deixa o mesmo estado, entao rodar duas vezes e inofensivo.
-- Sem BEGIN/COMMIT de nivel superior (regra da casa, AGENTS.md): o aplicador fornece a transacao inteira; pre-voo, troca do corpo e
-- conferencia final caem juntos ou nao caem. SET LOCAL lock_timeout: se outra sessao segurar a funcao, a migration falha limpa. Aditiva, sem DROP.
--
-- 7. ORDEM E ROLLBACK
--
-- DEPOIS da 20261399300000 (o pre-voo recusa uma loja ainda em outro corpo, inclusive uma redefinicao posterior desconhecida).
-- ROLLBACK MANUAL: rollback-manual-20261399985000_o_grafico_do_financeiro_soma_so_as_contas_ativas.sql devolve o corpo da 20261399300000 byte a
-- byte (LF), com pre-voo por hash que recusa corpo desconhecido (repetir o rollback e recusado sem escrever). Este rollback vem ANTES do
-- da 20261399300000 (o dele so aceita o corpo dele).
--
-- 8. FICHA DE VERIFICACAO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.fin_resumo(date,date)');
--      -- esperado: 9e711b03cc63f610461915b850f2eb70 (antes: a10e7f301eaf6b3edfac50bc87ff74bc).
--   2. proacl, prosecdef, proconfig e proowner iguais antes e depois (consulta 141a/141b).
--   PROVA VIVA: tests/banco/o-grafico-do-financeiro-soma-so-as-contas-ativas-viva.cjs (rpc-ci).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399985$
DECLARE
  v_assinatura text;
  v_hash_vigente text;
  v_hash_desta text;
  v_oid oid;
  v_hash text;
  v_atributos jsonb;
  v_public boolean;
  v_anon boolean;
  v_auth boolean;
  v_falta text;
BEGIN
  -- (assinatura, corpo vigente, corpo desta migration): o par que o rollback e as provas de migrations anteriores leem.
  SELECT e.assinatura, e.hash_vigente, e.hash_desta
    INTO v_assinatura, v_hash_vigente, v_hash_desta
    FROM (VALUES
      ('public.fin_resumo(date,date)', 'a10e7f301eaf6b3edfac50bc87ff74bc', '9e711b03cc63f610461915b850f2eb70')
    ) AS e(assinatura, hash_vigente, hash_desta);
  v_oid := to_regprocedure(v_assinatura);
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.fin_resumo(date,date) nao existe.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fin_resumo') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fin_resumo tem sobrecarga em public - meca a loja e revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEUDO: o vigente (aplica) ou o desta migration (reaplicar e no-op).
  SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
    INTO v_hash, v_atributos
    FROM pg_proc p
   WHERE p.oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN (v_hash_vigente, v_hash_desta) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de fin_resumo (hash %) nao e o vigente antes desta migration nem o que ela deixa - capture o corpo vivo e revise antes de aplicar.', COALESCE(v_hash, 'ausente');
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
     OR pg_get_function_arguments(v_oid) IS DISTINCT FROM 'p_inicio date, p_fim date' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de fin_resumo (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos, retorno ou dono) nao sao os conhecidos - meca a loja e revise antes de aplicar.';
  END IF;

  -- ACL: ninguem de PUBLIC nem anon; o admin logado (authenticated) executa. A ACL inteira (service_role inclusa) entra na fotografia.
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
  v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  IF NOT (NOT v_public AND NOT v_anon AND v_auth) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de fin_resumo nao e a conhecida (PUBLIC=%, anon=%, authenticated=%) - meca a loja e revise.', v_public, v_anon, v_auth;
  END IF;

  -- A conta do saldo ao fim do dia repete a de fin__saldos: so vale com o corpo de fin__saldos que esta migration conhece.
  IF to_regprocedure('public.fin__saldos()') IS NULL
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = to_regprocedure('public.fin__saldos()'))
        IS DISTINCT FROM '5992ecf164d886110c21dbf93a5c607e' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o corpo vivo de fin__saldos nao e o conhecido - a variacao diaria repete a conta dele; meca a loja e revise antes de aplicar.';
  END IF;

  -- O PL/pgSQL so acusa funcao ausente na hora de EXECUTAR, nao ao criar: confere antes.
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['public.fin__hoje()', 'public.fin__movimentos(date,date)', 'public.fin__saldos()', 'public.is_admin()', 'public.is_admin_atual()']) AS d(item)
   WHERE to_regprocedure(d.item) IS NULL;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: funcoes que o corpo novo chama nao existem: % - aplique as migrations anteriores antes.', v_falta;
  END IF;
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['public.fin_contas', 'public.fin_caixa_sessoes']) AS d(item)
   WHERE to_regclass(d.item) IS NULL;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: tabelas que o corpo novo le nao existem: % - aplique as migrations anteriores antes.', v_falta;
  END IF;
  SELECT string_agg(d.item, ', ' ORDER BY d.item) INTO v_falta
    FROM unnest(ARRAY['ativa', 'saldo_inicial_em']) AS d(item)
   WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = to_regclass('public.fin_contas') AND a.attname = d.item AND NOT a.attisdropped);
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: colunas de fin_contas que o corpo novo le nao existem: % - aplique as migrations anteriores antes.', v_falta;
  END IF;
  IF NOT (ARRAY['tipo', 'valor', 'data', 'conta_id', 'conta_destino_id']::text[]
          <@ COALESCE((SELECT p.proargnames FROM pg_proc p WHERE p.oid = to_regprocedure('public.fin__movimentos(date,date)')), ARRAY[]::text[])) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fin__movimentos nao devolve as colunas que o corpo novo le (tipo, valor, data, conta_id, conta_destino_id).';
  END IF;

  -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
  PERFORM set_config('ikcous.fin_resumo39985_atributos', v_atributos::text, true);
END $preflight_20261399985$;

-- fin_resumo: corpo vigente da 20261399300000_o_estorno_em_andamento_nao_e_conta_vencida.sql com SO a variacao diaria do saldo das contas
-- ativas (a CTE variacao e a chave serie[].variacao_saldo).
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
  ), variacao AS MATERIALIZED (
    -- Quanto o saldo das contas ATIVAS mudou em cada dia (20261399985000): a MESMA conta de fin__saldos, que e o saldo_total, so que dia a
    -- dia. So conta ativa; so movimento a partir do saldo_inicial_em da conta e ate hoje; a transferencia sai da conta de origem e entra na
    -- de destino. Assim saldo_total menos a soma desta variacao dos dias seguintes e o saldo ao fim do dia.
    -- MATERIALIZED: calculada UMA vez para todos os dias (sem isso o Postgres a refaz a cada dia da serie e o Financeiro fica mais lento).
    SELECT m.data AS dia,
           sum(CASE
                 WHEN m.tipo = 'entrada' AND m.conta_id = c.id THEN m.valor
                 WHEN m.tipo = 'saida' AND m.conta_id = c.id THEN -m.valor
                 WHEN m.tipo = 'transferencia' AND m.conta_id = c.id THEN -m.valor
                 WHEN m.tipo = 'transferencia' AND m.conta_destino_id = c.id THEN m.valor
                 ELSE 0 END) AS valor
      FROM periodo m
      JOIN public.fin_contas c ON c.ativa AND (m.conta_id = c.id OR m.conta_destino_id = c.id)
     WHERE m.data >= c.saldo_inicial_em AND m.data <= v_hoje
     GROUP BY m.data
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
                 'saidas', COALESCE((SELECT sum(valor) FROM periodo p WHERE p.data = d.dia::date AND p.tipo = 'saida'), 0),
                 'variacao_saldo', COALESCE((SELECT sum(v.valor) FROM variacao v WHERE v.dia = d.dia::date), 0)
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

-- CONFERENCIA no instante do apply: aborta se o corpo vivo nao e o novo, se algum atributo mudou, ou se a ACL abriu para PUBLIC ou anon
-- ou o authenticated perdeu o EXECUTE.
DO $conferencia_20261399985$
DECLARE
  v_oid oid := to_regprocedure('public.fin_resumo(date,date)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261399985: fin_resumo sumiu';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'fin_resumo') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261399985: fin_resumo ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '9e711b03cc63f610461915b850f2eb70' THEN
    RAISE EXCEPTION 'conferencia 20261399985: corpo vivo de fin_resumo (hash %) nao e o desta migration', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p
        WHERE p.oid = v_oid
          AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.fin_resumo39985_atributos')::jsonb
     ) THEN
    RAISE EXCEPTION 'conferencia 20261399985: atributos de fin_resumo mudaram (so o texto podia mudar)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261399985: fin_resumo alcancavel por PUBLIC';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261399985: anon executa fin_resumo';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261399985: authenticated perdeu EXECUTE em fin_resumo';
  END IF;
END $conferencia_20261399985$;
