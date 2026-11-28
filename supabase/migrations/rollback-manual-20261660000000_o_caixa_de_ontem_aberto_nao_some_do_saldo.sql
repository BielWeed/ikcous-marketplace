-- Rollback manual da 20261660000000 (o caixa de ontem aberto não some do saldo). Devolve, byte a byte (LF), mantendo
-- OID, dono, atributos e ACL:
--   fin_conta_salvar               -> corpo da 20261399930000
--   fin_caixa_movimentar_com_chave -> corpo da 20261654000000
--   fin_lancamento_cancelar        -> corpo da 20261199000000
-- Não toca em dados: nenhuma linha foi escrita pela 20261660000000 (ela só recusa), então não há o que desfazer nelas.
-- ATENÇÃO: reabre os dois defeitos (o saldo inicial posto depois do dia do caixa aberto faz a sangria, o suprimento e a
-- sobra/quebra desse caixa sumirem do saldo; e o cancelamento concorrente com o fechamento volta a deixar sobra falsa).
-- O pré-voo exige o corpo da 20261660000000 nas três: segundo rollback ou sucessora desconhecida recusa.
-- Sem controle de transação: o aplicador fornece a transação inteira.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261660000000$
DECLARE
  r record;
  v_hash text;
  v_atributos jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('fin_conta_salvar', 'public.fin_conta_salvar(jsonb)', '1dc6cfdb075e3a1a0882398e1220d0f1', 'd29894a41940ec4f5bc55ca2b103b69a'),
    ('fin_caixa_movimentar_com_chave', 'public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)', 'f1b22fd85f7a4ae2200d37001c9e1ffb', 'b7df8a8d11d64ab2cc2bd1dc31a57ae3'),
    ('fin_lancamento_cancelar', 'public.fin_lancamento_cancelar(uuid,text)', 'a0b036d6d16d323dc806732b85b8b1cf', 'ee75614cd65e5a7339045320e8a855c3')
  ) AS esperado(nome, assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos FROM pg_proc p
     WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) nao e o corpo desta migration; revise antes de desfazer.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = to_regprocedure(r.assinatura)
         AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
         AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset AND p.prokind = 'f'
         AND l.lanname = 'plpgsql' AND p.prorettype = 'jsonb'::regtype
         AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = r.nome) = 1
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem atributos ou permissoes diferentes dos esperados.', r.assinatura;
    END IF;
    -- Fotografar OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
    PERFORM set_config('ikcous.ontem1660rb_' || r.nome, v_atributos::text, true);
  END LOOP;
END $preflight_rollback_20261660000000$;

CREATE OR REPLACE FUNCTION public.fin_conta_salvar(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid := NULLIF(p ->> 'id', '')::uuid;
  v_atual public.fin_contas%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- NaN, infinito e o que passa do teto do numeric(12,2) recusam ANTES de qualquer escrita
  -- (criar ou editar): NaN passaria pelo cast e envenenaria o saldo total da loja. Saldo
  -- inicial NEGATIVO segue valendo (conta no vermelho); chave ausente ou nula segue como antes.
  IF p ? 'saldo_inicial'
     AND ((p ->> 'saldo_inicial')::numeric = 'NaN'::numeric
          OR abs((p ->> 'saldo_inicial')::numeric) > 9999999999.99) THEN
    RAISE EXCEPTION 'Informe o saldo inicial como um número válido.' USING ERRCODE = '22023';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.fin_contas (nome, tipo, saldo_inicial, saldo_inicial_em, ativa, ordem)
    VALUES (btrim(p ->> 'nome'), p ->> 'tipo',
            COALESCE((p ->> 'saldo_inicial')::numeric, 0),
            COALESCE((p ->> 'saldo_inicial_em')::date, public.fin__hoje()),
            COALESCE((p ->> 'ativa')::boolean, true),
            COALESCE((p ->> 'ordem')::integer, 10))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
  END IF;

  SELECT * INTO v_atual FROM public.fin_contas WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_atual.sistema AND p ? 'tipo' AND p ->> 'tipo' IS DISTINCT FROM v_atual.tipo THEN
    RAISE EXCEPTION 'As contas da loja não mudam de tipo.' USING ERRCODE = '22023';
  END IF;
  IF v_atual.sistema AND p ? 'ativa' AND NOT (p ->> 'ativa')::boolean THEN
    RAISE EXCEPTION 'As contas da loja recebem as vendas e não podem ser desativadas.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.fin_contas SET
    nome = CASE WHEN p ? 'nome' THEN btrim(p ->> 'nome') ELSE nome END,
    tipo = CASE WHEN p ? 'tipo' THEN p ->> 'tipo' ELSE tipo END,
    saldo_inicial = CASE WHEN p ? 'saldo_inicial' THEN (p ->> 'saldo_inicial')::numeric ELSE saldo_inicial END,
    saldo_inicial_em = CASE WHEN p ? 'saldo_inicial_em' THEN (p ->> 'saldo_inicial_em')::date ELSE saldo_inicial_em END,
    ativa = CASE WHEN p ? 'ativa' THEN (p ->> 'ativa')::boolean ELSE ativa END,
    ordem = CASE WHEN p ? 'ordem' THEN (p ->> 'ordem')::integer ELSE ordem END,
    updated_at = now()
  WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_caixa_movimentar_com_chave(p_sessao_id uuid, p_chave uuid, p_tipo text, p_valor numeric, p_descricao text, p_conta_contrapartida uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_s public.fin_caixa_sessoes%ROWTYPE;
  v_contra public.fin_contas%ROWTYPE;
  v_t public.fin_caixa_movimento_tentativas%ROWTYPE;
  v_valor numeric(12, 2);
  v_desc text;
  v_contra_id uuid;
  v_autor uuid := auth.uid();
  v_lanc uuid := gen_random_uuid();
  v_esperado numeric;
  v_dia date;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), antes de qualquer leitura ou replay.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_sessao_id IS NULL OR p_chave IS NULL THEN
    RAISE EXCEPTION 'Informe o caixa e a tentativa do movimento.' USING ERRCODE = '22023';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('sangria', 'suprimento') THEN
    RAISE EXCEPTION 'Use sangria (tirar do caixa) ou suprimento (colocar no caixa).' USING ERRCODE = '22023';
  END IF;
  -- Validação pura ANTES do cast: NaN, infinito e acima do teto nunca chegam ao numeric(12,2).
  IF p_valor IS NULL OR p_valor = 'NaN'::numeric OR p_valor <= 0 OR p_valor > 9999999999.99 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = '22023';
  END IF;
  v_valor := round(p_valor, 2);
  IF v_valor <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = '22023';
  END IF;
  v_desc := COALESCE(NULLIF(btrim(COALESCE(p_descricao, '')), ''),
                     CASE WHEN p_tipo = 'sangria' THEN 'Sangria do caixa' ELSE 'Suprimento do caixa' END);
  IF char_length(v_desc) > 140 THEN
    RAISE EXCEPTION 'A descrição do movimento pode ter até 140 caracteres.' USING ERRCODE = '22023';
  END IF;
  v_contra_id := COALESCE(p_conta_contrapartida, 'f1000000-0000-4000-8000-000000000002'::uuid);

  -- A sessão PEDIDA, travada pelo id.
  SELECT * INTO v_s FROM public.fin_caixa_sessoes WHERE id = p_sessao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = '22023';
  END IF;

  -- Reserva da tentativa ANTES de status/saldo/conta ativa. A PK é global: a mesma
  -- chave em outra sessão espera a transação dona dela e depois cai na comparação.
  INSERT INTO public.fin_caixa_movimento_tentativas
    (chave, sessao_id, autor, tipo, valor, descricao, contrapartida_id, lancamento_id)
  VALUES (p_chave, v_s.id, v_autor, p_tipo, v_valor, v_desc, v_contra_id, v_lanc)
  ON CONFLICT (chave) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO v_t FROM public.fin_caixa_movimento_tentativas WHERE chave = p_chave;
    IF v_t.sessao_id IS DISTINCT FROM v_s.id
       OR v_t.autor IS DISTINCT FROM v_autor
       OR v_t.tipo IS DISTINCT FROM p_tipo
       OR v_t.valor IS DISTINCT FROM v_valor
       OR v_t.descricao IS DISTINCT FROM v_desc
       OR v_t.contrapartida_id IS DISTINCT FROM v_contra_id THEN
      RAISE EXCEPTION 'Esta tentativa já foi usada para outro movimento. Confira o caixa antes de repetir.'
        USING ERRCODE = '22023', DETAIL = 'tentativa_divergente';
    END IF;
    RETURN jsonb_build_object('id', v_t.lancamento_id, 'replay', true,
                              'status', (SELECT l.status FROM public.fin_lancamentos l WHERE l.id = v_t.lancamento_id));
  END IF;
  -- Fim da reserva da tentativa.

  IF v_s.status <> 'aberto' THEN
    RAISE EXCEPTION 'Este caixa não está aberto.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_contra FROM public.fin_contas WHERE id = v_contra_id;
  IF NOT FOUND OR NOT v_contra.ativa OR v_contra.id = v_s.conta_id THEN
    RAISE EXCEPTION 'Escolha para qual conta o dinheiro vai (ou de onde vem).' USING ERRCODE = '22023';
  END IF;
  IF p_tipo = 'sangria' THEN
    v_esperado := (public.fin__caixa_calculo(v_s.id) ->> 'esperado')::numeric;
    IF v_valor > v_esperado THEN
      RAISE EXCEPTION 'A sangria (R$ %) é maior que o dinheiro esperado no caixa (R$ %).', v_valor, v_esperado
        USING ERRCODE = '22023';
    END IF;
  END IF;
  -- O caixa pertence ao dia (Brasília) em que abriu (20261654000000): a sangria/suprimento vai para
  -- o dia da abertura, mesmo feito depois da meia-noite com o caixa ainda aberto.
  v_dia := public.fin__dia(v_s.aberto_em);
  INSERT INTO public.fin_lancamentos (
    id, tipo, status, valor, conta_id, conta_destino_id, descricao, forma_pagamento,
    data_competencia, data_vencimento, data_realizacao, origem, caixa_sessao_id, criado_por
  ) VALUES (
    v_lanc, 'transferencia', 'realizado', v_valor,
    CASE WHEN p_tipo = 'sangria' THEN v_s.conta_id ELSE v_contra.id END,
    CASE WHEN p_tipo = 'sangria' THEN v_contra.id ELSE v_s.conta_id END,
    v_desc, 'dinheiro', v_dia, v_dia, v_dia, p_tipo, v_s.id, v_autor
  );
  RETURN jsonb_build_object('id', v_lanc, 'replay', false, 'status', 'realizado');
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_lancamento_cancelar(p_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_l public.fin_lancamentos%ROWTYPE;
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF v_motivo IS NULL OR char_length(v_motivo) > 300 THEN
    RAISE EXCEPTION 'Diga por que o lançamento está sendo cancelado.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_l FROM public.fin_lancamentos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_l.status = 'cancelado' THEN
    RAISE EXCEPTION 'Este lançamento já está cancelado.' USING ERRCODE = '22023';
  END IF;
  -- Caixa fechado é conferência encerrada: não se reescreve.
  IF v_l.caixa_sessao_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.fin_caixa_sessoes s WHERE s.id = v_l.caixa_sessao_id AND s.status = 'fechado'
  ) THEN
    RAISE EXCEPTION 'Este movimento faz parte de um caixa já fechado e não pode ser cancelado.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.fin_lancamentos
     SET status = 'cancelado', cancelado_em = now(), cancelado_por = auth.uid(),
         motivo_cancelamento = v_motivo, updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id, 'status', 'cancelado');
END;
$$;

DO $conferencia_rollback_20261660000000$
BEGIN
  IF (SELECT count(*) FROM (VALUES
        ('public.fin_conta_salvar(jsonb)', 'fin_conta_salvar', '1dc6cfdb075e3a1a0882398e1220d0f1'),
        ('public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)', 'fin_caixa_movimentar_com_chave', 'f1b22fd85f7a4ae2200d37001c9e1ffb'),
        ('public.fin_lancamento_cancelar(uuid,text)', 'fin_lancamento_cancelar', 'a0b036d6d16d323dc806732b85b8b1cf')
      ) AS esperado(assinatura, nome, hash)
      WHERE EXISTS (
        SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(esperado.assinatura)
          AND md5(replace(p.prosrc, E'\r', '')) = esperado.hash
          AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.ontem1660rb_' || esperado.nome)::jsonb
      )) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261660000000 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_rollback_20261660000000$;

NOTIFY pgrst, 'reload schema';
