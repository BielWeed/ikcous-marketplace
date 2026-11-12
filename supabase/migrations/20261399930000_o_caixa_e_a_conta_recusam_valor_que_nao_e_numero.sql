-- O CAIXA E A CONTA RECUSAM VALOR QUE NAO E NUMERO (onda 150, lote E; 11/11/2026).
--
-- DEFEITO. Em Postgres o NaN nao e menor que zero (ele e ordenado acima de todo numero) e cabe em
-- numeric(12,2). fin_caixa_abrir recusava so `v_valor IS NULL OR v_valor < 0`: chamada direta da RPC
-- por um admin com 'NaN' gravava uma sessao de caixa com valor_abertura NaN e um ajuste de caixa de
-- valor NaN (CHECK `valor > 0` e `valor_abertura >= 0` aceitam NaN pela mesma regra); dai o saldo,
-- o esperado do caixa, a diferenca do fechamento e a Visao do Financeiro passavam a devolver NaN, e
-- a sessao nao se desfaz sozinha. fin_conta_salvar nao validava saldo_inicial: 'NaN' envenenava o
-- saldo total da loja. As irmas fin_caixa_fechar_sessao e fin_caixa_movimentar_com_chave
-- (20261252000000) ja recusam NaN, infinito e acima do teto com 22023; estas duas ficaram de fora.
-- A tela barra NaN em parseValorBR: o furo e da RPC chamada sem a tela (exposicao baixa, so admin;
-- dano alto se ocorrer).
--
-- O QUE FAZ (so duas funcoes, CREATE OR REPLACE, nesta ordem):
--  1. fin_caixa_abrir: o corpo vigente da 20261370000000 inteiro, com UMA guarda nova ANTES do cast
--     `round(p_valor_abertura, 2)` (a declaracao `v_valor numeric(12,2) := round(...)` passa a
--     atribuicao depois da guarda: o inicializador do DECLARE rodava ANTES de qualquer IF e deixava o
--     infinito cair em 22003 em vez de 22023). Guarda: NaN ou |valor| > 9999999999.99 -> 22023, a
--     mesma frase da guarda de baixo, que continua valendo (nulo e negativo).
--  2. fin_conta_salvar: o corpo vigente da 20261199000000 inteiro, com UMA guarda nova depois das
--     portas de admin e antes de qualquer escrita (criar ou editar): se a chave saldo_inicial veio e
--     o numero e NaN, infinito ou |valor| > 9999999999.99 -> 22023. Saldo inicial NEGATIVO segue
--     valido (conta no vermelho); chave ausente e JSON null seguem como antes.
-- Assinatura, retorno, SECURITY DEFINER, search_path, dono, OID e GRANTs ficam iguais.
--
-- DADOS EXISTENTES. Nenhuma linha e lida ou reescrita (so o corpo de duas funcoes muda). Sessao de
-- caixa ou conta que ja tenham sido gravadas antes seguem como estao: esta migration nao corrige
-- nem apaga nada. Valores validos de hoje continuam aceitos; a unica diferenca de comportamento
-- fora do NaN/infinito e que valor acima do teto (> 9999999999.99) passa a dar 22023 com a frase
-- da funcao, no lugar do 22003 generico do cast.
--
-- IDEMPOTENCIA. O pre-voo aceita o corpo vigente OU o desta migration (hash do prosrc sem CR),
-- confere assinatura, atributos e ACL das duas; reaplicar deixa o mesmo estado. O pos-voo confere
-- os dois hashes e que todos os atributos (OID, dono, ACL, config) sao os fotografados no pre-voo.
-- Corpo desconhecido (outra sucessora) recusa com B1_BASELINE_DIVERGENT antes de escrever.
--
-- FORA DO ESCOPO. Nao mexe em fin_caixa_fechar_sessao, fin_caixa_movimentar_com_chave nem em
-- fin_lancamento_salvar; nao adiciona CHECK nas tabelas; nao muda o front.
--
-- COMO APLICAR. node scripts/db-apply.cjs supabase/migrations/20261399930000_o_caixa_e_a_conta_recusam_valor_que_nao_e_numero.sql
-- (sem BEGIN/COMMIT de nivel superior neste arquivo, regra da casa: o aplicador fornece a
-- transacao inteira, e uma falha no meio nao grava metade).
-- ORDEM: depois da 20261370000000 (o pre-voo recusa corpo anterior de fin_caixa_abrir).
-- FICHA DE VERIFICACAO (so leitura, so catalogo): consultas 128a (depois) e 128b (antes) em
-- scripts/publicacao/consultas/; comportamento em tests/banco/o-caixa-e-a-conta-recusam-nan-viva.cjs
-- (somente Postgres efemero do CI).
-- ROLLBACK MANUAL: rollback-manual-20261399930000_o_caixa_e_a_conta_recusam_valor_que_nao_e_numero.sql
-- devolve os dois corpos anteriores byte a byte (LF, sem CR); recusa corpo desconhecido e segundo
-- rollback. Reabre o defeito do NaN. Nenhuma linha e removida ou reescrita.
--
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399930000$
DECLARE
  r record;
  v_hash text;
  v_atributos jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('fin_caixa_abrir', 'public.fin_caixa_abrir(numeric,uuid)', '28ab512e291378a01d110e298af7a402', '367d298dcc78bc2829fc4e0048005a0c'),
    ('fin_conta_salvar', 'public.fin_conta_salvar(jsonb)', '2f9b720cb3804edba4879595b0d6fe1d', '1dc6cfdb075e3a1a0882398e1220d0f1')
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
         AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
         AND l.lanname = 'plpgsql' AND p.prorettype = 'jsonb'::regtype
         AND pg_get_function_arguments(p.oid) = CASE r.nome
                WHEN 'fin_caixa_abrir' THEN 'p_valor_abertura numeric, p_conta_id uuid DEFAULT NULL::uuid'
                ELSE 'p jsonb' END
         AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = r.nome) = 1
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem assinatura, atributos ou permissoes diferentes dos esperados.', r.assinatura;
    END IF;
    -- Fotografar OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
    PERFORM set_config('ikcous.nan399930_' || r.nome, v_atributos::text, true);
  END LOOP;
END $preflight_20261399930000$;

CREATE OR REPLACE FUNCTION public.fin_caixa_abrir(p_valor_abertura numeric, p_conta_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_conta public.fin_contas%ROWTYPE;
  v_saldo numeric;
  v_ultimo_contado numeric;
  v_categoria uuid;
  v_valor numeric(12, 2);
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- NaN, infinito e o que passa do teto do numeric(12,2) recusam ANTES do cast: NaN não é
  -- menor que zero (o Postgres o ordena acima de todo número) e passaria pela guarda de baixo,
  -- gravando uma sessão e um ajuste de caixa de valor NaN (mesma forma de fin_caixa_fechar_sessao).
  IF p_valor_abertura = 'NaN'::numeric OR abs(p_valor_abertura) > 9999999999.99 THEN
    RAISE EXCEPTION 'Informe quanto dinheiro há no caixa (pode ser zero).' USING ERRCODE = '22023';
  END IF;
  v_valor := round(p_valor_abertura, 2);
  IF v_valor IS NULL OR v_valor < 0 THEN
    RAISE EXCEPTION 'Informe quanto dinheiro há no caixa (pode ser zero).' USING ERRCODE = '22023';
  END IF;
  IF p_conta_id IS NOT NULL AND p_conta_id <> 'f1000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'Abra o caixa na conta Caixa da loja. Contas personalizadas não recebem as vendas do balcão.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_conta FROM public.fin_contas
   WHERE id = COALESCE(p_conta_id, 'f1000000-0000-4000-8000-000000000001'::uuid) FOR UPDATE;
  IF NOT FOUND OR NOT v_conta.ativa OR v_conta.tipo <> 'caixa' THEN
    RAISE EXCEPTION 'Escolha uma conta do tipo caixa.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fin_caixa_sessoes WHERE conta_id = v_conta.id AND status = 'aberto') THEN
    RAISE EXCEPTION 'Este caixa já está aberto.' USING ERRCODE = '23505';
  END IF;

  -- O que foi contado manda: a diferença vira ajuste, para a conta Caixa
  -- refletir a gaveta de verdade.
  --
  -- Achado 13 (revisão 26/09/2026, rodada 2 — decisão do dono, reversível).
  -- Achado A1 (revisão 26/09/2026, rodada 3 — REGRESSÃO do achado 13
  -- consertada): a CATEGORIA tem de decidir com a MESMA base de comparação
  -- que o TIPO/VALOR do lançamento já usam (v_valor contra v_saldo, o saldo
  -- de fin__saldos AGORA) — não contra v_ultimo_contado. A suposição de que
  -- "sem nada estranho no meio, v_saldo já é igual ao último contado" era
  -- verdadeira SÓ quando nada mexe na conta entre o fechamento e a próxima
  -- abertura; uma venda ou despesa em dinheiro registrada com o caixa
  -- FECHADO (fin_caixa_movimentar/fin__movimentos continuam escrevendo na
  -- conta mesmo sem sessão aberta) faz v_saldo divergir de v_ultimo_contado,
  -- e comparar contra a base errada trocava sobra por falta (e vice-versa):
  -- uma falta real de R$30 saía como "sobra" fora_dre, e uma sobra real de
  -- R$10 saía como "Quebra de caixa" (despesa) com sinal de ganho — uma
  -- combinação que a própria fin_lancamento_salvar recusaria se alguém
  -- tentasse lançar à mão.
  --   - v_valor > v_saldo (sobrou dinheiro na gaveta) — sempre `fora_dre`
  --     (categoria 006): aporte do dono, troco trazido de casa, nunca lucro.
  --   - v_valor < v_saldo E existe um fechamento anterior desta conta para
  --     comparar — falta REAL (sumiu dinheiro que o sistema sabia que
  --     estava lá) — Quebra de caixa, `financeiro`, pesa na DRE (031).
  --   - v_valor < v_saldo SEM fechamento anterior (1ª abertura desta conta,
  --     nada para comparar) — `fora_dre` (categoria 007): pode ser só a
  --     loja começando com menos troco do que o sistema supõe, não uma
  --     perda comprovada.
  -- O ajuste continua reconciliando o SALDO do sistema (fin__saldos) para
  -- v_valor — o mesmo cálculo de sempre (achado E) — só a CATEGORIA muda.
  SELECT s.saldo INTO v_saldo FROM public.fin__saldos() s WHERE s.conta_id = v_conta.id;
  SELECT s.valor_contado INTO v_ultimo_contado
    FROM public.fin_caixa_sessoes s
   WHERE s.conta_id = v_conta.id AND s.status = 'fechado'
   ORDER BY s.fechado_em DESC LIMIT 1;

  IF round(v_valor - COALESCE(v_saldo, 0), 2) <> 0 THEN
    v_categoria := CASE
      WHEN v_valor > COALESCE(v_saldo, 0)
        THEN 'f2000000-0000-4000-8000-000000000006'::uuid -- fora_dre: sobra/aporte
      WHEN v_ultimo_contado IS NOT NULL
        THEN 'f2000000-0000-4000-8000-000000000031'::uuid -- Quebra de caixa (financeiro, na DRE)
      ELSE 'f2000000-0000-4000-8000-000000000007'::uuid   -- fora_dre: falta (1ª abertura)
    END;
    INSERT INTO public.fin_lancamentos (
      tipo, status, valor, conta_id, categoria_id, descricao, forma_pagamento,
      data_competencia, data_vencimento, data_realizacao, origem, criado_por
    ) VALUES (
      CASE WHEN v_valor > COALESCE(v_saldo, 0) THEN 'entrada' ELSE 'saida' END,
      'realizado', abs(round(v_valor - COALESCE(v_saldo, 0), 2)), v_conta.id,
      v_categoria,
      'Ajuste na abertura do caixa (contado x sistema)', 'dinheiro',
      public.fin__hoje(), public.fin__hoje(), public.fin__hoje(), 'ajuste_caixa', auth.uid()
    );
  END IF;

  INSERT INTO public.fin_caixa_sessoes (conta_id, valor_abertura, aberto_por)
  VALUES (v_conta.id, v_valor, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;

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

DO $conferencia_20261399930000$
BEGIN
  IF (SELECT count(*) FROM (VALUES
        ('public.fin_caixa_abrir(numeric,uuid)', 'fin_caixa_abrir', '367d298dcc78bc2829fc4e0048005a0c'),
        ('public.fin_conta_salvar(jsonb)', 'fin_conta_salvar', '1dc6cfdb075e3a1a0882398e1220d0f1')
      ) AS esperado(assinatura, nome, hash)
      WHERE EXISTS (
        SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(esperado.assinatura)
          AND md5(replace(p.prosrc, E'\r', '')) = esperado.hash
          AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.nan399930_' || esperado.nome)::jsonb
      )) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261399930000 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_20261399930000$;

NOTIFY pgrst, 'reload schema';
