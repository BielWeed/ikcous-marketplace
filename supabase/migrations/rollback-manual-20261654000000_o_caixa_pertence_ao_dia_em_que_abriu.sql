-- Rollback manual da 20261654000000 (o caixa pertence ao dia em que abriu). Devolve, byte a byte (LF), mantendo OID,
-- dono, atributos e ACL:
--   fin_lancamento_salvar          -> corpo da 20261246000000
--   fin_lancamento_baixar          -> corpo da 20261199000000
--   fin_caixa_fechar_sessao        -> corpo da 20261252000000
--   fin_caixa_movimentar_com_chave -> corpo da 20261252000000
-- Nao toca em dados: o ajuste, a sangria, o suprimento e o lancamento gravados com a data da abertura (ou ligados a
-- uma sessao aberta num dia anterior) enquanto a 20261654000000 esteve no ar FICAM como foram gravados.
-- ATENCAO: reabre o defeito (a quebra do caixa que fecha depois da meia-noite volta para o dia do fechamento, e o
-- gasto pago no dia da abertura e lancado depois da meia-noite volta a ficar fora da gaveta). O aviso da folha de
-- lancamento do front passa a descrever uma regra que o banco nao segue mais: retirar o front junto, se for o caso.
-- O pre-voo exige o corpo da 20261654000000 nas quatro: segundo rollback ou sucessora desconhecida recusa.
-- Sem controle de transacao: o aplicador fornece a transacao inteira.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261654000000$
DECLARE
  r record;
  v_hash text;
  v_atributos jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('fin_lancamento_salvar', 'public.fin_lancamento_salvar(jsonb)', '1356dbfc037a9202ef163ba598854891', '3e31817ce1d13bb091ce2d0871cbd718'),
    ('fin_lancamento_baixar', 'public.fin_lancamento_baixar(uuid,date,uuid)', 'e59bc12ea20182da4209a257df0be8c1', '7d1204cdf214a290cfdb378482795f1b'),
    ('fin_caixa_fechar_sessao', 'public.fin_caixa_fechar_sessao(uuid,numeric,text)', 'f10208ba223450fd25af3c9e11dca073', '3bc5c509d150fca3c5135361461dcc40'),
    ('fin_caixa_movimentar_com_chave', 'public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)', '134bd5b7c5872bf30041601725fc37ba', 'f1b22fd85f7a4ae2200d37001c9e1ffb')
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
    PERFORM set_config('ikcous.caixa1654rb_' || r.nome, v_atributos::text, true);
  END LOOP;
END $preflight_rollback_20261654000000$;

CREATE OR REPLACE FUNCTION public.fin_lancamento_salvar(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_hoje date := public.fin__hoje();
  v_id uuid := NULLIF(p ->> 'id', '')::uuid;
  v_tipo text := p ->> 'tipo';
  v_status text := COALESCE(p ->> 'status', 'realizado');
  v_valor numeric(12, 2);
  v_conta public.fin_contas%ROWTYPE;
  v_destino public.fin_contas%ROWTYPE;
  v_cat public.fin_categorias%ROWTYPE;
  v_desc text := btrim(COALESCE(p ->> 'descricao', ''));
  v_forma text := NULLIF(p ->> 'forma_pagamento', '');
  v_comp date;
  v_venc date;
  v_real date;
  v_parcelas integer := COALESCE((p ->> 'parcelas')::integer, 1);
  v_grupo uuid;
  v_valor_parcela numeric(12, 2);
  v_ids uuid[] := '{}';
  v_novo uuid;
  v_sessao uuid;
  v_atual public.fin_lancamentos%ROWTYPE;
  -- Tentativa de criação (20261246000000). Sem chave, o caminho antigo não muda.
  v_chave uuid;
  v_conteudo_hash text;
  v_hash_gravado text;
  v_ids_gravados uuid[];
  i integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Lançamento inválido.' USING ERRCODE = '22023';
  END IF;
  IF v_tipo IS NULL OR v_tipo NOT IN ('entrada', 'saida', 'transferencia') THEN
    RAISE EXCEPTION 'Escolha: receita, despesa ou transferência.' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('previsto', 'realizado') THEN
    RAISE EXCEPTION 'Status inválido.' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_valor := round((p ->> 'valor')::numeric, 2);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Valor inválido.' USING ERRCODE = '22023';
  END;
  IF v_valor IS NULL OR v_valor <= 0 OR v_valor > 9999999999.99 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_desc) NOT BETWEEN 1 AND 140 THEN
    RAISE EXCEPTION 'Descreva o lançamento (até 140 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF v_parcelas NOT BETWEEN 1 AND 48 THEN
    RAISE EXCEPTION 'Parcelas de 1 a 48.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_conta FROM public.fin_contas WHERE id = NULLIF(p ->> 'conta_id', '')::uuid;
  IF NOT FOUND OR NOT v_conta.ativa THEN
    RAISE EXCEPTION 'Escolha uma conta ativa.' USING ERRCODE = '22023';
  END IF;
  IF v_tipo = 'transferencia' THEN
    SELECT * INTO v_destino FROM public.fin_contas WHERE id = NULLIF(p ->> 'conta_destino_id', '')::uuid;
    IF NOT FOUND OR NOT v_destino.ativa OR v_destino.id = v_conta.id THEN
      RAISE EXCEPTION 'Escolha a conta de destino (diferente da de origem).' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT * INTO v_cat FROM public.fin_categorias WHERE id = NULLIF(p ->> 'categoria_id', '')::uuid;
    IF NOT FOUND OR NOT v_cat.ativa THEN
      RAISE EXCEPTION 'Escolha uma categoria.' USING ERRCODE = '22023';
    END IF;
    IF (v_tipo = 'entrada') <> (v_cat.natureza = 'receita') THEN
      RAISE EXCEPTION 'A categoria não combina com o tipo do lançamento.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_forma IS NOT NULL AND v_forma NOT IN ('pix', 'credito', 'debito', 'cartao', 'dinheiro', 'boleto', 'transferencia', 'outro') THEN
    RAISE EXCEPTION 'Forma de pagamento inválida.' USING ERRCODE = '22023';
  END IF;

  v_comp := COALESCE(NULLIF(p ->> 'data_competencia', '')::date, v_hoje);
  v_venc := COALESCE(NULLIF(p ->> 'data_vencimento', '')::date, v_comp);
  v_real := CASE WHEN v_status = 'realizado' THEN COALESCE(NULLIF(p ->> 'data_realizacao', '')::date, v_hoje) END;
  IF v_real IS NOT NULL AND v_real > v_hoje THEN
    RAISE EXCEPTION 'Lançamento já pago/recebido não pode ter data no futuro. Use "a pagar/a receber".'
      USING ERRCODE = '22023';
  END IF;

  -- Movimento de hoje na conta de um caixa aberto entra na conferência dele.
  IF v_status = 'realizado' AND v_real = v_hoje THEN
    SELECT s.id INTO v_sessao FROM public.fin_caixa_sessoes s
     WHERE s.status = 'aberto' AND (s.conta_id = v_conta.id OR (v_tipo = 'transferencia' AND s.conta_id = v_destino.id))
     ORDER BY s.aberto_em DESC LIMIT 1;
  END IF;

  IF v_id IS NOT NULL THEN
    -- Edição: só o previsto manual; realizado se cancela e lança de novo.
    SELECT * INTO v_atual FROM public.fin_lancamentos WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002';
    END IF;
    IF v_atual.status <> 'previsto' OR v_atual.origem <> 'manual' THEN
      RAISE EXCEPTION 'Só um lançamento a pagar/receber pode ser editado. Para corrigir um já realizado, cancele e lance de novo.'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.fin_lancamentos SET
      tipo = v_tipo, status = v_status, valor = v_valor, conta_id = v_conta.id,
      conta_destino_id = CASE WHEN v_tipo = 'transferencia' THEN v_destino.id END,
      categoria_id = CASE WHEN v_tipo = 'transferencia' THEN NULL ELSE v_cat.id END,
      descricao = v_desc, forma_pagamento = v_forma, data_competencia = v_comp,
      data_vencimento = v_venc, data_realizacao = v_real, caixa_sessao_id = v_sessao,
      observacao = NULLIF(btrim(COALESCE(p ->> 'observacao', '')), ''), updated_at = now()
    WHERE id = v_id;
    RETURN jsonb_build_object('ids', jsonb_build_array(v_id));
  END IF;

  -- Reserva a tentativa ANTES de inserir qualquer parcela, depois de todas as validações.
  -- O índice único espera uma transação concorrente terminar. Em READ COMMITTED,
  -- o SELECT seguinte enxerga os ids commitados por ela; abortar desfaz a reserva junto.
  IF NULLIF(p ->> 'chave_idempotencia', '') IS NOT NULL THEN
    BEGIN
      v_chave := (p ->> 'chave_idempotencia')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Chave de tentativa inválida.' USING ERRCODE = '22023';
    END;
    v_conteudo_hash := md5((p - 'chave_idempotencia')::text);
    INSERT INTO public.fin_lancamento_tentativas (chave, conteudo_hash, ids)
    VALUES (v_chave, v_conteudo_hash, '{}')
    ON CONFLICT (chave) DO NOTHING;
    IF NOT FOUND THEN
      SELECT t.conteudo_hash, t.ids INTO v_hash_gravado, v_ids_gravados
        FROM public.fin_lancamento_tentativas t WHERE t.chave = v_chave;
      IF v_hash_gravado IS DISTINCT FROM v_conteudo_hash THEN
        RAISE EXCEPTION 'Esta tentativa já foi usada para outro lançamento. Confira a lista antes de salvar de novo.'
          USING ERRCODE = '22023';
      END IF;
      RETURN jsonb_build_object('ids', to_jsonb(v_ids_gravados));
    END IF;
  END IF;
  -- Fim da reserva da tentativa.

  v_grupo := CASE WHEN v_parcelas > 1 THEN gen_random_uuid() END;
  v_valor_parcela := trunc(v_valor / v_parcelas, 2);
  FOR i IN 1..v_parcelas LOOP
    INSERT INTO public.fin_lancamentos (
      tipo, status, valor, conta_id, conta_destino_id, categoria_id, descricao, forma_pagamento,
      data_competencia, data_vencimento, data_realizacao, grupo_parcelas, parcela, parcelas,
      caixa_sessao_id, observacao, criado_por
    ) VALUES (
      v_tipo,
      CASE WHEN i = 1 THEN v_status ELSE 'previsto' END,
      CASE WHEN i = v_parcelas THEN v_valor - v_valor_parcela * (v_parcelas - 1) ELSE v_valor_parcela END,
      v_conta.id,
      CASE WHEN v_tipo = 'transferencia' THEN v_destino.id END,
      CASE WHEN v_tipo = 'transferencia' THEN NULL ELSE v_cat.id END,
      CASE WHEN v_parcelas > 1 THEN left(v_desc, 128) || ' (' || i || '/' || v_parcelas || ')' ELSE v_desc END,
      v_forma,
      (v_comp + make_interval(months => i - 1))::date,
      (v_venc + make_interval(months => i - 1))::date,
      CASE WHEN i = 1 THEN v_real END,
      v_grupo,
      CASE WHEN v_parcelas > 1 THEN i END,
      CASE WHEN v_parcelas > 1 THEN v_parcelas END,
      CASE WHEN i = 1 THEN v_sessao END,
      NULLIF(btrim(COALESCE(p ->> 'observacao', '')), ''),
      auth.uid()
    ) RETURNING id INTO v_novo;
    v_ids := v_ids || v_novo;
  END LOOP;
  -- Guarda o resultado na MESMA transação das parcelas e da reserva da tentativa.
  IF v_chave IS NOT NULL THEN
    UPDATE public.fin_lancamento_tentativas SET ids = v_ids WHERE chave = v_chave;
  END IF;
  -- Fim do resultado da tentativa.
  RETURN jsonb_build_object('ids', to_jsonb(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_lancamento_baixar(p_id uuid, p_data date DEFAULT NULL::date, p_conta_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_l public.fin_lancamentos%ROWTYPE;
  v_data date := COALESCE(p_data, public.fin__hoje());
  v_conta uuid;
  v_sessao uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_l FROM public.fin_lancamentos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_l.status <> 'previsto' THEN
    RAISE EXCEPTION 'Este lançamento já foi baixado ou cancelado.' USING ERRCODE = '22023';
  END IF;
  IF v_data > public.fin__hoje() THEN
    RAISE EXCEPTION 'A baixa não pode ter data no futuro.' USING ERRCODE = '22023';
  END IF;
  v_conta := COALESCE(p_conta_id, v_l.conta_id);
  IF NOT EXISTS (SELECT 1 FROM public.fin_contas c WHERE c.id = v_conta AND c.ativa) THEN
    RAISE EXCEPTION 'Escolha uma conta ativa.' USING ERRCODE = '22023';
  END IF;
  IF v_conta = v_l.conta_destino_id THEN
    RAISE EXCEPTION 'A conta de origem precisa ser diferente da de destino.' USING ERRCODE = '22023';
  END IF;
  IF v_data = public.fin__hoje() THEN
    SELECT s.id INTO v_sessao FROM public.fin_caixa_sessoes s
     WHERE s.status = 'aberto' AND (s.conta_id = v_conta OR s.conta_id = v_l.conta_destino_id)
     ORDER BY s.aberto_em DESC LIMIT 1;
  END IF;
  UPDATE public.fin_lancamentos
     SET status = 'realizado', data_realizacao = v_data, conta_id = v_conta,
         caixa_sessao_id = v_sessao, updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id, 'status', 'realizado');
END;
$$;

CREATE OR REPLACE FUNCTION public.fin_caixa_fechar_sessao(p_sessao_id uuid, p_valor_contado numeric, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_s public.fin_caixa_sessoes%ROWTYPE;
  v_contado numeric(12, 2);
  v_obs text;
  v_esperado numeric(12, 2);
  v_dif numeric(12, 2);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), antes de qualquer leitura ou replay.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p_sessao_id IS NULL THEN
    RAISE EXCEPTION 'Informe qual caixa fechar.' USING ERRCODE = '22023';
  END IF;
  -- Validação pura ANTES do cast: NaN, infinito e acima do teto nunca chegam ao numeric(12,2).
  IF p_valor_contado IS NULL OR p_valor_contado = 'NaN'::numeric
     OR p_valor_contado < 0 OR p_valor_contado > 9999999999.99 THEN
    RAISE EXCEPTION 'Informe quanto dinheiro foi contado no caixa.' USING ERRCODE = '22023';
  END IF;
  v_contado := round(p_valor_contado, 2);
  v_obs := NULLIF(btrim(COALESCE(p_observacao, '')), '');
  IF char_length(v_obs) > 500 THEN
    RAISE EXCEPTION 'A observação do fechamento pode ter até 500 caracteres.' USING ERRCODE = '22023';
  END IF;

  -- A sessão PEDIDA, nunca "a última aberta": o retry de S1 não enxerga S2.
  SELECT * INTO v_s FROM public.fin_caixa_sessoes WHERE id = p_sessao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caixa não encontrado.' USING ERRCODE = '22023';
  END IF;
  IF v_s.status = 'fechado' THEN
    IF v_s.fechado_por IS NOT DISTINCT FROM auth.uid()
       AND v_s.valor_contado IS NOT DISTINCT FROM v_contado
       AND v_s.observacao IS NOT DISTINCT FROM v_obs THEN
      RETURN jsonb_build_object('id', v_s.id, 'esperado', v_s.valor_esperado, 'contado', v_s.valor_contado,
                                'diferenca', v_s.diferenca, 'replay', true);
    END IF;
    RAISE EXCEPTION 'Este caixa já foi fechado com outros dados. Confira o histórico antes de fechar de novo.'
      USING ERRCODE = '22023', DETAIL = 'fechamento_divergente';
  END IF;

  v_esperado := round((public.fin__caixa_calculo(v_s.id) ->> 'esperado')::numeric, 2);
  v_dif := v_contado - v_esperado;

  IF v_dif <> 0 THEN
    INSERT INTO public.fin_lancamentos (
      tipo, status, valor, conta_id, categoria_id, descricao, forma_pagamento,
      data_competencia, data_vencimento, data_realizacao, origem, caixa_sessao_id, criado_por
    ) VALUES (
      CASE WHEN v_dif > 0 THEN 'entrada' ELSE 'saida' END, 'realizado', abs(v_dif), v_s.conta_id,
      CASE WHEN v_dif > 0 THEN 'f2000000-0000-4000-8000-000000000005'::uuid
           ELSE 'f2000000-0000-4000-8000-000000000031'::uuid END,
      CASE WHEN v_dif > 0 THEN 'Sobra de caixa no fechamento' ELSE 'Quebra de caixa no fechamento' END,
      'dinheiro', public.fin__hoje(), public.fin__hoje(), public.fin__hoje(), 'ajuste_caixa', v_s.id, auth.uid()
    );
  END IF;

  UPDATE public.fin_caixa_sessoes
     SET status = 'fechado', fechado_em = now(), fechado_por = auth.uid(),
         valor_contado = v_contado, valor_esperado = v_esperado, diferenca = v_dif,
         observacao = v_obs
   WHERE id = v_s.id;
  RETURN jsonb_build_object('id', v_s.id, 'esperado', v_esperado, 'contado', v_contado,
                            'diferenca', v_dif, 'replay', false);
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
  INSERT INTO public.fin_lancamentos (
    id, tipo, status, valor, conta_id, conta_destino_id, descricao, forma_pagamento,
    data_competencia, data_vencimento, data_realizacao, origem, caixa_sessao_id, criado_por
  ) VALUES (
    v_lanc, 'transferencia', 'realizado', v_valor,
    CASE WHEN p_tipo = 'sangria' THEN v_s.conta_id ELSE v_contra.id END,
    CASE WHEN p_tipo = 'sangria' THEN v_contra.id ELSE v_s.conta_id END,
    v_desc, 'dinheiro', public.fin__hoje(), public.fin__hoje(), public.fin__hoje(), p_tipo, v_s.id, v_autor
  );
  RETURN jsonb_build_object('id', v_lanc, 'replay', false, 'status', 'realizado');
END;
$$;

DO $conferencia_rollback_20261654000000$
BEGIN
  IF (SELECT count(*) FROM (VALUES
        ('public.fin_lancamento_salvar(jsonb)', 'fin_lancamento_salvar', '1356dbfc037a9202ef163ba598854891'),
        ('public.fin_lancamento_baixar(uuid,date,uuid)', 'fin_lancamento_baixar', 'e59bc12ea20182da4209a257df0be8c1'),
        ('public.fin_caixa_fechar_sessao(uuid,numeric,text)', 'fin_caixa_fechar_sessao', 'f10208ba223450fd25af3c9e11dca073'),
        ('public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)', 'fin_caixa_movimentar_com_chave', '134bd5b7c5872bf30041601725fc37ba')
      ) AS esperado(assinatura, nome, hash)
      WHERE EXISTS (
        SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(esperado.assinatura)
          AND md5(replace(p.prosrc, E'\r', '')) = esperado.hash
          AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.caixa1654rb_' || esperado.nome)::jsonb
      )) <> 4 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261654000000 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_rollback_20261654000000$;

NOTIFY pgrst, 'reload schema';
