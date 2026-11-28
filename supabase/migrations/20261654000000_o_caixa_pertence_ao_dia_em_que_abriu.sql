-- O CAIXA PERTENCE AO DIA EM QUE ABRIU (caça de 28/11/2026, base c97c1bed6; dinheiro).
--
-- DEFEITO (cenário: a lojista abre o caixa em 30/11 às 09:00 e fecha às 00:40 de 01/12).
--  1. fin_caixa_fechar_sessao (20261252000000) grava a "Quebra de caixa"/"Sobra de caixa" com a data do dia do
--     FECHAMENTO (fin__hoje()). O resultado do mês (fin_dre, 20261405900000) conta o ajuste pela data_competencia:
--     a quebra caía em DEZEMBRO, enquanto as vendas daquele caixa ficaram em NOVEMBRO. O mesmo com a sangria e o
--     suprimento de fin_caixa_movimentar_com_chave feitos depois da meia-noite.
--  2. fin_lancamento_salvar (20261246000000) só ligava ao caixa aberto o que foi pago com data == hoje
--     (`v_real = v_hoje`). O gasto em dinheiro lançado às 00:20 com "pago em 30/11" (o caixa de 30/11 ainda aberto)
--     não saía da gaveta: o fechamento acusava uma falta que não existe, e a "Quebra de caixa" somava-se à despesa
--     (a mesma despesa contada duas vezes). fin_lancamento_baixar (corpo da 20261199000000) tinha a mesma regra
--     (`v_data = fin__hoje()`) para o "marcar como pago".
--
-- O PRINCÍPIO: o caixa pertence ao dia (calendário de Brasília, fin__dia) em que foi ABERTO.
--
-- O QUE FAZ (só quatro corpos, CREATE OR REPLACE, nesta ordem; assinatura, retorno, SECURITY DEFINER,
-- search_path, dono, OID e ACL iguais, nenhum GRANT nem REVOKE):
--  1. fin_lancamento_salvar: corpo vivo da 20261246000000; SÓ a escolha da sessão muda. Pago (realizado) com data
--     entre o dia da abertura do caixa aberto e hoje entra na conferência dele (`v_real >= fin__dia(aberto_em)`;
--     o futuro já era recusado antes). Caixa aberto HOJE só recebe o pago hoje: o de ontem segue fora (cenários
--     C4/C5 de o-saldo-da-conta-e-o-ajuste-do-caixa-batem-viva.cjs).
--  2. fin_lancamento_baixar: corpo vivo da 20261199000000; a mesma regra para a baixa (`v_data >= fin__dia(aberto_em)`).
--  3. fin_caixa_fechar_sessao: corpo vivo da 20261252000000; a sobra/quebra leva a data do dia da abertura da
--     sessão (competência, vencimento e realização), não a de hoje.
--  4. fin_caixa_movimentar_com_chave: corpo vivo da 20261252000000; a sangria/suprimento leva a data do dia da
--     abertura da sessão.
-- Caixa de um dia só (abre e fecha no mesmo dia): fin__dia(aberto_em) = fin__hoje(), tudo exatamente como antes.
--
-- DADOS EXISTENTES. Nenhuma linha é lida para reescrita nem apagada: só o corpo de quatro funções muda. Quebra,
-- sangria e lançamento gravados antes do apply ficam com a data e a sessão que já têm (inclusive os que caíram no
-- mês errado). Uma sessão que estiver ABERTA na hora do apply passa a seguir a regra nova dali em diante: o que for
-- lançado depois com data entre o dia da abertura dela e hoje entra nela, e o fechamento dela leva a data da abertura.
--
-- IDEMPOTÊNCIA. O pré-voo aceita, para cada uma das quatro, o corpo vigente OU o desta migration (hash do prosrc sem
-- CR) e confere assinatura, atributos e ACL; reaplicar deixa o mesmo estado. Corpo desconhecido (outra sucessora)
-- recusa com B1_BASELINE_DIVERGENT antes de escrever. O pós-voo confere os quatro hashes e que OID, dono, ACL e
-- todos os atributos são os fotografados no pré-voo.
--
-- COMO APLICAR. Pelo aplicar-migrations.yml (ou node scripts/db-apply.cjs <este arquivo>). Sem BEGIN/COMMIT de nível
-- superior neste arquivo, regra da casa (AGENTS.md): o aplicador fornece a transação inteira, e uma falha no meio
-- não grava metade. ORDEM: depois da 20261246000000 e da 20261252000000 (o pré-voo recusa os corpos anteriores a elas).
-- Banco antes do front (o aviso novo da folha de lançamento descreve a regra nova).
-- FICHA DE VERIFICAÇÃO (só leitura, só catálogo): consultas 209a (depois) e 209b (antes) em scripts/publicacao/consultas/;
-- comportamento em tests/banco/o-caixa-pertence-ao-dia-em-que-abriu-viva.cjs (somente Postgres efêmero do CI).
-- ROLLBACK MANUAL: rollback-manual-20261654000000_o_caixa_pertence_ao_dia_em_que_abriu.sql devolve os quatro corpos
-- anteriores byte a byte (LF); recusa corpo desconhecido e segundo rollback. Reabre o defeito. Nenhuma linha é removida
-- ou reescrita (o que foi gravado com a data da abertura fica como foi gravado).
--
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261654000000$
DECLARE
  r record;
  v_hash text;
  v_atributos jsonb;
BEGIN
  IF to_regprocedure('public.fin__dia(timestamptz)') IS NULL
     OR to_regprocedure('public.fin__hoje()') IS NULL
     OR to_regprocedure('public.is_admin()') IS NULL
     OR to_regprocedure('public.is_admin_atual()') IS NULL
     OR to_regclass('public.fin_caixa_sessoes') IS NULL
     OR to_regclass('public.fin_lancamentos') IS NULL
     OR (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
          WHERE a.attrelid = to_regclass('public.fin_caixa_sessoes') AND a.attname = 'aberto_em' AND NOT a.attisdropped)
        IS DISTINCT FROM 'timestamp with time zone'
     OR (SELECT pg_get_function_result(to_regprocedure('public.fin__dia(timestamptz)'))) IS DISTINCT FROM 'date' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta dependência do caixa (fin__dia, fin__hoje, gates de admin ou fin_caixa_sessoes.aberto_em).';
  END IF;
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
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) nao e o corpo vigente nem o desta migration; revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = to_regprocedure(r.assinatura)
         AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
         AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset AND p.prokind = 'f'
         AND l.lanname = 'plpgsql' AND p.prorettype = 'jsonb'::regtype
         AND pg_get_function_arguments(p.oid) = CASE r.nome
                WHEN 'fin_lancamento_salvar' THEN 'p jsonb'
                WHEN 'fin_lancamento_baixar' THEN 'p_id uuid, p_data date DEFAULT NULL::date, p_conta_id uuid DEFAULT NULL::uuid'
                WHEN 'fin_caixa_fechar_sessao' THEN 'p_sessao_id uuid, p_valor_contado numeric, p_observacao text DEFAULT NULL::text'
                ELSE 'p_sessao_id uuid, p_chave uuid, p_tipo text, p_valor numeric, p_descricao text, p_conta_contrapartida uuid DEFAULT NULL::uuid' END
         AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = r.nome) = 1
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem assinatura, atributos ou permissoes diferentes dos esperados.', r.assinatura;
    END IF;
    -- Fotografar OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
    PERFORM set_config('ikcous.caixa1654_' || r.nome, v_atributos::text, true);
  END LOOP;
END $preflight_20261654000000$;

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
  v_dia date;
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

  -- O caixa pertence ao dia (Brasília) em que abriu (20261654000000): a sobra/quebra vai para o
  -- dia da abertura, mesmo fechando depois da meia-noite.
  v_dia := public.fin__dia(v_s.aberto_em);
  IF v_dif <> 0 THEN
    INSERT INTO public.fin_lancamentos (
      tipo, status, valor, conta_id, categoria_id, descricao, forma_pagamento,
      data_competencia, data_vencimento, data_realizacao, origem, caixa_sessao_id, criado_por
    ) VALUES (
      CASE WHEN v_dif > 0 THEN 'entrada' ELSE 'saida' END, 'realizado', abs(v_dif), v_s.conta_id,
      CASE WHEN v_dif > 0 THEN 'f2000000-0000-4000-8000-000000000005'::uuid
           ELSE 'f2000000-0000-4000-8000-000000000031'::uuid END,
      CASE WHEN v_dif > 0 THEN 'Sobra de caixa no fechamento' ELSE 'Quebra de caixa no fechamento' END,
      'dinheiro', v_dia, v_dia, v_dia, 'ajuste_caixa', v_s.id, auth.uid()
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

DO $conferencia_20261654000000$
BEGIN
  IF (SELECT count(*) FROM (VALUES
        ('public.fin_lancamento_salvar(jsonb)', 'fin_lancamento_salvar', '3e31817ce1d13bb091ce2d0871cbd718'),
        ('public.fin_lancamento_baixar(uuid,date,uuid)', 'fin_lancamento_baixar', '7d1204cdf214a290cfdb378482795f1b'),
        ('public.fin_caixa_fechar_sessao(uuid,numeric,text)', 'fin_caixa_fechar_sessao', '3bc5c509d150fca3c5135361461dcc40'),
        ('public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)', 'fin_caixa_movimentar_com_chave', 'f1b22fd85f7a4ae2200d37001c9e1ffb')
      ) AS esperado(assinatura, nome, hash)
      WHERE EXISTS (
        SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(esperado.assinatura)
          AND md5(replace(p.prosrc, E'\r', '')) = esperado.hash
          AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.caixa1654_' || esperado.nome)::jsonb
      )) <> 4 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261654000000 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_20261654000000$;

NOTIFY pgrst, 'reload schema';
