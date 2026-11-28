-- O CAIXA DE ONTEM ABERTO NAO SOME DO SALDO (caça de 28/11/2026, base a0d88b494; dinheiro).
--
-- A CAUSA COMUM. O saldo de cada conta (fin__saldos, 20261177000000) é o saldo inicial MAIS os movimentos com data a
-- partir da data do saldo inicial. A 20261654000000 (o caixa pertence ao dia em que abriu) grava a sangria, o
-- suprimento e a sobra/quebra do fechamento com a data do dia em que a sessão ABRIU. Com o caixa de ontem ainda
-- aberto depois da meia-noite, um saldo inicial com data de hoje numa conta em que esse caixa lança deixa esses
-- valores com data ANTERIOR ao saldo inicial: eles somem do saldo.
--
-- DEFEITO 1 (dinheiro errado no Resultado). Caixa aberto em 30/11 com R$ 100, recebe R$ 500. Às 00:05 de 01/12 a
-- lojista acerta o saldo inicial do Caixa para R$ 600 "em 01/12"; às 00:10 faz a sangria de R$ 500 para o banco (data
-- de 30/11: some do Caixa, que segue mostrando R$ 600); o fechamento bate (100 contra 100); a abertura das 09:00 conta
-- R$ 100 contra os R$ 600 do sistema e lança uma "Quebra de caixa" FALSA de R$ 500. O mesmo com a sangria para uma
-- conta criada depois da meia-noite (o saldo dela nasce com a data de hoje; a sangria de 30/11 some dele).
-- DEFEITO 2 (dois aparelhos). fin_lancamento_cancelar conferia se a sessão do caixa estava fechada SEM travá-la; o
-- fechamento trava. Cancelar uma sangria enquanto o outro aparelho fecha o caixa deixava o fechamento contar a sangria
-- que acabou cancelada: sobra falsa no fechamento e quebra falsa na abertura seguinte.
--
-- O DESENHO (b, a recusa): enquanto um caixa está aberto, toda conta em que ele lança só conta o saldo a partir de uma
-- data que NÃO passa do dia da abertura dele. Duas portas guardam isso, e nenhuma linha gravada muda:
--  1. fin_conta_salvar (corpo vivo da 20261399930000): mudar o saldo inicial (valor ou data) de uma conta para uma data
--     DEPOIS do dia da abertura de um caixa aberto que lança nela (a conta do caixa, ou a de um movimento realizado
--     dessa sessão com data anterior à data nova) recusa com 22023 e a frase da loja. Nome, ordem, ativa, ou o mesmo
--     saldo e a mesma data reenviados, seguem livres; criar conta segue livre.
--  2. fin_caixa_movimentar_com_chave (corpo vivo da 20261654000000): a sangria/o suprimento recusa (22023) se a conta do
--     caixa ou a contrapartida só conta o saldo DEPOIS do dia da abertura (a conta criada depois da meia-noite). A
--     contrapartida passa a ser lida FOR SHARE: quem muda o saldo inicial dela ao mesmo tempo (fin_conta_salvar, FOR
--     UPDATE) espera ou é esperado, e o segundo a chegar lê a data nova.
--  3. fin_lancamento_cancelar (corpo vivo da 20261199000000): trava a sessão do caixa (FOR UPDATE) antes de conferir se
--     ela fechou. Ordem das travas: o lançamento e depois a sessão; o fechamento só trava a sessão e nunca espera um
--     lançamento existente (só INSERE o ajuste), então não há ciclo.
-- POR QUE NÃO A SAÍDA (a), o carimbo de "quando o saldo inicial foi informado": exigia coluna nova e mudar o cálculo do
-- saldo em fin__saldos, no gráfico (fin_resumo, 20261399985000) e na âncora do extrato no front, e mudava o saldo de
-- quem NÃO está neste cenário (o gasto antigo lançado depois de acertar o saldo, que a lojista já contou no saldo
-- informado, passaria a contar duas vezes). A recusa não muda o saldo de ninguém: só impede a combinação que some.
--
-- DADOS EXISTENTES. Nenhuma linha é lida para reescrita nem apagada: só o corpo de três funções muda (CREATE OR
-- REPLACE; assinatura, retorno, SECURITY DEFINER, search_path, dono, OID e ACL iguais; nenhum GRANT nem REVOKE, nenhuma
-- tabela, coluna ou índice). Saldo inicial, sessão e lançamento gravados antes do apply ficam como estão, inclusive uma
-- loja que JÁ esteja no estado ruim (caixa de ontem aberto e saldo inicial depois do dia dele): o apply não conserta
-- nem piora; dali em diante a sangria/suprimento dessa conta recusa até a lojista fechar o caixa ou acertar a data.
--
-- IDEMPOTÊNCIA. O pré-voo aceita, para cada uma das três, o corpo vigente OU o desta migration (hash do prosrc sem CR)
-- e confere assinatura, atributos e ACL; reaplicar deixa o mesmo estado. Corpo desconhecido (outra sucessora) recusa
-- com B1_BASELINE_DIVERGENT antes de escrever. O pós-voo confere os três hashes e que OID, dono, ACL e todos os
-- atributos são os fotografados no pré-voo.
--
-- COMO APLICAR. Pelo aplicar-migrations.yml (ou node scripts/db-apply.cjs <este arquivo>). Sem BEGIN/COMMIT de nível
-- superior neste arquivo, regra da casa (AGENTS.md): o aplicador fornece a transação inteira, e uma falha no meio
-- não grava metade. ORDEM: depois da 20261399930000 e da 20261654000000 (o pré-voo recusa os corpos anteriores a elas).
-- Banco antes do front (o front só muda um aviso e funciona com o banco antes ou depois).
-- FICHA DE VERIFICAÇÃO (só leitura, só catálogo): consultas 216a (depois) e 216b (antes) em scripts/publicacao/consultas/;
-- comportamento em tests/banco/o-caixa-de-ontem-aberto-nao-some-do-saldo-viva.cjs (somente Postgres efêmero do CI).
-- ROLLBACK MANUAL: rollback-manual-20261660000000_o_caixa_de_ontem_aberto_nao_some_do_saldo.sql devolve os três corpos
-- anteriores byte a byte (LF); recusa corpo desconhecido e segundo rollback. Reabre os dois defeitos. Nenhuma linha é
-- removida ou reescrita.
--
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261660000000$
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
     OR to_regclass('public.fin_contas') IS NULL
     OR (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
          WHERE a.attrelid = to_regclass('public.fin_caixa_sessoes') AND a.attname = 'aberto_em' AND NOT a.attisdropped)
        IS DISTINCT FROM 'timestamp with time zone'
     OR (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
          WHERE a.attrelid = to_regclass('public.fin_contas') AND a.attname = 'saldo_inicial_em' AND NOT a.attisdropped)
        IS DISTINCT FROM 'date'
     OR (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
          WHERE a.attrelid = to_regclass('public.fin_lancamentos') AND a.attname = 'data_realizacao' AND NOT a.attisdropped)
        IS DISTINCT FROM 'date'
     OR (SELECT pg_get_function_result(to_regprocedure('public.fin__dia(timestamptz)'))) IS DISTINCT FROM 'date' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta dependência do caixa ou do saldo (fin__dia, fin__hoje, gates de admin, fin_caixa_sessoes.aberto_em, fin_contas.saldo_inicial_em ou fin_lancamentos.data_realizacao).';
  END IF;
  FOR r IN SELECT * FROM (VALUES
    ('fin_conta_salvar', 'public.fin_conta_salvar(jsonb)', '1dc6cfdb075e3a1a0882398e1220d0f1', 'd29894a41940ec4f5bc55ca2b103b69a'),
    ('fin_caixa_movimentar_com_chave', 'public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)', 'f1b22fd85f7a4ae2200d37001c9e1ffb', 'b7df8a8d11d64ab2cc2bd1dc31a57ae3'),
    ('fin_lancamento_cancelar', 'public.fin_lancamento_cancelar(uuid,text)', 'a0b036d6d16d323dc806732b85b8b1cf', 'ee75614cd65e5a7339045320e8a855c3')
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
                WHEN 'fin_conta_salvar' THEN 'p jsonb'
                WHEN 'fin_lancamento_cancelar' THEN 'p_id uuid, p_motivo text'
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
    PERFORM set_config('ikcous.ontem1660_' || r.nome, v_atributos::text, true);
  END LOOP;
END $preflight_20261660000000$;

CREATE OR REPLACE FUNCTION public.fin_conta_salvar(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid := NULLIF(p ->> 'id', '')::uuid;
  v_atual public.fin_contas%ROWTYPE;
  v_novo_em date;
  v_dia_do_caixa date;
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
  -- >>> o caixa de ontem aberto (20261660000000)
  -- A sessao de caixa ainda ABERTA grava a sangria, o suprimento e a sobra/quebra com a data do dia em que abriu
  -- (20261654000000), e o saldo so soma o que tem data a partir do saldo inicial da conta. Por o saldo inicial desta
  -- conta DEPOIS desse dia, com o caixa aberto lancando nela, fazia esses valores sumirem do saldo (e a abertura
  -- seguinte acusava uma "Quebra de caixa" falsa). Recusa antes de escrever. Nome, ordem, ativa ou o mesmo saldo e a
  -- mesma data reenviados seguem livres. A conta ja esta travada (FOR UPDATE, acima): a sangria/suprimento le a
  -- contrapartida FOR SHARE, entao as duas nunca se cruzam sem uma ver a outra.
  v_novo_em := CASE WHEN p ? 'saldo_inicial_em' THEN (p ->> 'saldo_inicial_em')::date ELSE v_atual.saldo_inicial_em END;
  IF v_novo_em IS DISTINCT FROM v_atual.saldo_inicial_em
     OR (p ? 'saldo_inicial' AND (p ->> 'saldo_inicial')::numeric IS DISTINCT FROM v_atual.saldo_inicial) THEN
    SELECT public.fin__dia(s.aberto_em) INTO v_dia_do_caixa
      FROM public.fin_caixa_sessoes s
     WHERE s.status = 'aberto'
       AND public.fin__dia(s.aberto_em) < v_novo_em
       AND (s.conta_id = v_id OR EXISTS (
             SELECT 1 FROM public.fin_lancamentos l
              WHERE l.caixa_sessao_id = s.id AND l.status = 'realizado'
                AND (l.conta_id = v_id OR l.conta_destino_id = v_id)
                AND l.data_realizacao < v_novo_em))
     ORDER BY s.aberto_em
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'O caixa aberto em % ainda lança nesta conta com a data desse dia. Feche esse caixa antes de mudar o saldo inicial para depois de %, ou use a data % ou uma anterior.',
        to_char(v_dia_do_caixa, 'DD/MM/YYYY'), to_char(v_dia_do_caixa, 'DD/MM/YYYY'), to_char(v_dia_do_caixa, 'DD/MM/YYYY')
        USING ERRCODE = '22023';
    END IF;
  END IF;
  -- <<< o caixa de ontem aberto (20261660000000)
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
  v_tardia public.fin_contas%ROWTYPE;
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
  SELECT * INTO v_contra FROM public.fin_contas WHERE id = v_contra_id FOR SHARE;
  IF NOT FOUND OR NOT v_contra.ativa OR v_contra.id = v_s.conta_id THEN
    RAISE EXCEPTION 'Escolha para qual conta o dinheiro vai (ou de onde vem).' USING ERRCODE = '22023';
  END IF;
  -- >>> o caixa de ontem aberto (20261660000000)
  -- A sangria/o suprimento leva a data do dia da ABERTURA (abaixo), e o saldo de cada conta so soma o que tem data a
  -- partir do saldo inicial dela. Se a conta do caixa ou a contrapartida so conta o saldo DEPOIS desse dia, o valor
  -- sumia do saldo dela (o caso comum: a conta criada depois da meia-noite, com o caixa de ontem ainda aberto).
  -- Recusa antes de gravar. A contrapartida foi lida FOR SHARE (acima): quem muda o saldo inicial dela ao mesmo tempo
  -- (fin_conta_salvar, FOR UPDATE) espera esta, ou esta espera aquela e le a data nova.
  SELECT * INTO v_tardia FROM public.fin_contas c
   WHERE c.id IN (v_s.conta_id, v_contra.id)
     AND c.saldo_inicial_em > public.fin__dia(v_s.aberto_em)
   ORDER BY c.saldo_inicial_em DESC, c.id
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'A conta % só conta o saldo a partir de %, depois do dia deste caixa (%): % ficaria fora do saldo dela. Feche este caixa e abra outro, ou mude a data do saldo inicial da conta % para % ou antes.',
      v_tardia.nome, to_char(v_tardia.saldo_inicial_em, 'DD/MM/YYYY'), to_char(public.fin__dia(v_s.aberto_em), 'DD/MM/YYYY'),
      CASE WHEN p_tipo = 'sangria' THEN 'a sangria' ELSE 'o suprimento' END,
      v_tardia.nome, to_char(public.fin__dia(v_s.aberto_em), 'DD/MM/YYYY')
      USING ERRCODE = '22023';
  END IF;
  -- <<< o caixa de ontem aberto (20261660000000)
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
  -- >>> o caixa de ontem aberto (20261660000000)
  -- Trava a sessao do caixa ANTES de conferir se ela fechou: o fechamento (fin_caixa_fechar_sessao) trava a mesma
  -- linha e calcula o esperado com ela travada. Sem esta trava, cancelar uma sangria enquanto outro aparelho fecha o
  -- caixa deixava o fechamento contar a sangria que acabou cancelada (sobra falsa no fechamento e quebra falsa na
  -- abertura seguinte). Quem chega depois espera e rele o status. Ordem: o lancamento (acima) e depois a sessao; o
  -- fechamento so trava a sessao e nunca espera um lancamento existente, entao nao ha ciclo.
  IF v_l.caixa_sessao_id IS NOT NULL THEN
    PERFORM 1 FROM public.fin_caixa_sessoes s WHERE s.id = v_l.caixa_sessao_id FOR UPDATE;
  END IF;
  -- <<< o caixa de ontem aberto (20261660000000)
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

DO $conferencia_20261660000000$
BEGIN
  IF (SELECT count(*) FROM (VALUES
        ('public.fin_conta_salvar(jsonb)', 'fin_conta_salvar', 'd29894a41940ec4f5bc55ca2b103b69a'),
        ('public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)', 'fin_caixa_movimentar_com_chave', 'b7df8a8d11d64ab2cc2bd1dc31a57ae3'),
        ('public.fin_lancamento_cancelar(uuid,text)', 'fin_lancamento_cancelar', 'ee75614cd65e5a7339045320e8a855c3')
      ) AS esperado(assinatura, nome, hash)
      WHERE EXISTS (
        SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(esperado.assinatura)
          AND md5(replace(p.prosrc, E'\r', '')) = esperado.hash
          AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.ontem1660_' || esperado.nome)::jsonb
      )) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261660000000 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_20261660000000$;

NOTIFY pgrst, 'reload schema';
