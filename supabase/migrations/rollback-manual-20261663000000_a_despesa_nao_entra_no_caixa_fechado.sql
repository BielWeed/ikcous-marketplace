-- Rollback manual da 20261663000000 (a despesa não entra no caixa fechado). Devolve, byte a byte (LF), mantendo
-- OID, dono, atributos e ACL:
--   fin_lancamento_salvar -> corpo da 20261654000000
--   fin_lancamento_baixar -> corpo da 20261654000000
-- Não toca em dados: nenhuma linha foi escrita pela 20261663000000 (ela só trava a leitura da sessão), então não há o que
-- desfazer nelas.
-- ATENÇÃO: reabre a corrida (a despesa ou a baixa que corre com o fechamento do caixa volta a poder gravar ligada ao caixa
-- já fechado, com uma Quebra de caixa falsa no fechamento).
-- O pré-voo exige o corpo da 20261663000000 nas duas: segundo rollback ou sucessora desconhecida recusa.
-- Sem controle de transação: o aplicador fornece a transação inteira.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261663000000$
DECLARE
  r record;
  v_hash text;
  v_atributos jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('fin_lancamento_salvar', 'public.fin_lancamento_salvar(jsonb)', '3e31817ce1d13bb091ce2d0871cbd718', '729fc6e3e4a643459df835d214fa082e'),
    ('fin_lancamento_baixar', 'public.fin_lancamento_baixar(uuid,date,uuid)', '7d1204cdf214a290cfdb378482795f1b', '0abf8da5b460d8b8236ffb5ffc111524')
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
    PERFORM set_config('ikcous.despesa1663rb_' || r.nome, v_atributos::text, true);
  END LOOP;
END $preflight_rollback_20261663000000$;

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

  -- O caixa pertence ao dia (Brasília) em que abriu (20261654000000): o que foi pago entre o dia da
  -- abertura e hoje, na conta de um caixa ainda aberto, entra na conferência dele. Caixa aberto hoje
  -- só recebe o de hoje (o pago ontem não saiu da gaveta de hoje).
  IF v_status = 'realizado' THEN
    SELECT s.id INTO v_sessao FROM public.fin_caixa_sessoes s
     WHERE s.status = 'aberto' AND (s.conta_id = v_conta.id OR (v_tipo = 'transferencia' AND s.conta_id = v_destino.id))
       AND v_real >= public.fin__dia(s.aberto_em)
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
  -- O caixa pertence ao dia (Brasília) em que abriu (20261654000000): a baixa com data entre o dia da
  -- abertura e hoje, na conta de um caixa ainda aberto, entra na conferência dele.
  SELECT s.id INTO v_sessao FROM public.fin_caixa_sessoes s
   WHERE s.status = 'aberto' AND (s.conta_id = v_conta OR s.conta_id = v_l.conta_destino_id)
     AND v_data >= public.fin__dia(s.aberto_em)
   ORDER BY s.aberto_em DESC LIMIT 1;
  UPDATE public.fin_lancamentos
     SET status = 'realizado', data_realizacao = v_data, conta_id = v_conta,
         caixa_sessao_id = v_sessao, updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id, 'status', 'realizado');
END;
$$;

DO $conferencia_rollback_20261663000000$
BEGIN
  IF (SELECT count(*) FROM (VALUES
        ('public.fin_lancamento_salvar(jsonb)', 'fin_lancamento_salvar', '3e31817ce1d13bb091ce2d0871cbd718'),
        ('public.fin_lancamento_baixar(uuid,date,uuid)', 'fin_lancamento_baixar', '7d1204cdf214a290cfdb378482795f1b')
      ) AS esperado(assinatura, nome, hash)
      WHERE EXISTS (
        SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(esperado.assinatura)
          AND md5(replace(p.prosrc, E'\r', '')) = esperado.hash
          AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.despesa1663rb_' || esperado.nome)::jsonb
      )) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261663000000 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_rollback_20261663000000$;

NOTIFY pgrst, 'reload schema';
