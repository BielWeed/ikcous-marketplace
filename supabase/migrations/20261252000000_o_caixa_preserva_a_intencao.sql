-- ============================================================================
-- Migration 20261252000000 — o caixa preserva a intenção (dinheiro)
-- ============================================================================
-- CX1: fin_caixa_fechar escolhe "o caixa aberto mais recente". Se a resposta do
-- fechamento de S1 se perde, alguém abre S2 e o aparelho repete, o retry fecha S2.
-- CX2: fin_caixa_movimentar não tem identidade de tentativa: a sangria de 50 com
-- saldo 300 repetida grava DUAS transferências. As duas foram vistas VERMELHAS no
-- PG17 efêmero (rpc-ci run 39418487244, SHA 4a909274, CX1 e CX2 com [DANO]).
--
-- Contrato NOVO e ADITIVO (spec docs/superpowers/specs/2026-10-20-noturno-onda2-design.md):
--   fin_caixa_fechar_sessao(p_sessao_id, p_valor_contado, p_observacao)
--   fin_caixa_movimentar_com_chave(p_sessao_id, p_chave, p_tipo, p_valor, p_descricao, p_conta_contrapartida)
-- Nomes novos (sem sobrecarga). As RPCs ANTIGAS ficam com corpo, hash e grants
-- intactos (pré-voo e pós-voo medem); cliente antigo continua com o risco nomeado.
--
-- Ordem nas duas: gates is_admin() e is_admin_atual() ANTES de qualquer leitura ou
-- replay (rebaixado = 42501 mesmo repetindo); validação pura (nulo, NaN, infinito,
-- teto 9999999999.99, descrição <= 140, observação <= 500) ANTES de qualquer cast
-- para numeric(12,2); trava da sessão PELO ID pedido.
-- Fechamento: aberta = efeitos de sempre, uma vez. Fechada pelo mesmo autor com o
-- mesmo contado/observação normalizados = devolve o gravado (replay=true) sem
-- recalcular nem escrever. Qualquer outra = 22023, DETAIL fechamento_divergente.
-- Movimento: reserva a chave (PK global, INSERT ... ON CONFLICT DO NOTHING) ANTES de
-- olhar status/saldo/conta ativa, para o replay continuar depois do fechamento, do
-- esgotamento ou da desativação da conta. Replay compara sessão, autor e cada coluna
-- (IS NOT DISTINCT FROM, sem hash textual de numeric) e devolve o lançamento original
-- e o status ATUAL dele; divergência = 22023, DETAIL tentativa_divergente. Chave nova
-- segue as checagens de sempre e grava o lançamento com o id reservado. Qualquer
-- RAISE desfaz reserva e lançamento juntos (mesma transação; FKs adiadas).
-- autor é NULL quando quem chama não tem auth.uid() (service_role/postgres), como o
-- criado_por de sempre; a comparação IS NOT DISTINCT FROM cobre esse caso.
--
-- Tabela fin_caixa_movimento_tentativas: só o servidor (RLS ligada, nenhuma política,
-- REVOKE ALL de PUBLIC/anon/authenticated/service_role, fora de publicação).
-- RETENÇÃO: uma linha pequena por movimento com chave; nada é apagado.
-- Sem BEGIN/COMMIT próprios: quem aplica abre a transação. Aplicar 2x é idêntico.
-- Rollback comum (rollback-manual-20261252000000_...) remove SÓ as RPCs novas, depois
-- de retirar o consumidor; PRESERVA a tabela e as tentativas.
-- PROVA: tests/banco/caixa-intencao-viva.cjs (alvo chave) + consultas 55a/55b.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261252$
DECLARE
  v_t regclass := to_regclass('public.fin_caixa_movimento_tentativas');
  v_dono oid := (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.fin_caixa_fechar(numeric,text)'));
BEGIN
  IF to_regprocedure('public.is_admin()') IS NULL
     OR to_regprocedure('public.is_admin_atual()') IS NULL
     OR to_regprocedure('public.fin__hoje()') IS NULL
     OR to_regprocedure('public.fin__caixa_calculo(uuid)') IS NULL
     OR to_regclass('public.fin_caixa_sessoes') IS NULL
     OR to_regclass('public.fin_lancamentos') IS NULL
     OR to_regclass('public.fin_contas') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta dependência do caixa ou dos gates de admin.';
  END IF;
  -- As antigas ficam INTACTAS: corpo vigente da 20261199000000, sem sobrecarga.
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fin_caixa_fechar') <> 1
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fin_caixa_movimentar') <> 1
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.fin_caixa_fechar(numeric,text)'))
          IS DISTINCT FROM '69a9dd8988cdc05392f500deb64f349f'
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.fin_caixa_movimentar(text,numeric,text,uuid)'))
          IS DISTINCT FROM 'd7e8dfeec40f89dff51f4cb3ccf14b9a' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo das RPCs antigas do caixa desconhecido.';
  END IF;
  -- As novas: ausentes, ou exatamente estas (reaplicação).
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fin_caixa_fechar_sessao')
       <> (to_regprocedure('public.fin_caixa_fechar_sessao(uuid,numeric,text)') IS NOT NULL)::int
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fin_caixa_movimentar_com_chave')
       <> (to_regprocedure('public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)') IS NOT NULL)::int
     OR COALESCE((SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
                   WHERE oid = to_regprocedure('public.fin_caixa_fechar_sessao(uuid,numeric,text)')), 'f10208ba223450fd25af3c9e11dca073')
          <> 'f10208ba223450fd25af3c9e11dca073'
     OR COALESCE((SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
                   WHERE oid = to_regprocedure('public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)')), '134bd5b7c5872bf30041601725fc37ba')
          <> '134bd5b7c5872bf30041601725fc37ba' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: RPCs novas do caixa já existem com outra forma ou sobrecarga.';
  END IF;
  IF v_t IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_t AND relkind = 'r' AND relrowsecurity
                    AND NOT relforcerowsecurity AND relowner = v_dono)
       OR (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
             FROM pg_attribute a WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped)
          IS DISTINCT FROM 'chave:uuid:true,sessao_id:uuid:true,autor:uuid:false,tipo:text:true,valor:numeric(12,2):true,descricao:text:true,contrapartida_id:uuid:true,lancamento_id:uuid:true,criado_em:timestamp with time zone:true'
       OR (SELECT count(*) FROM pg_constraint WHERE conrelid = v_t) <> 4
       OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = v_t AND contype = 'p' AND pg_get_constraintdef(oid) = 'PRIMARY KEY (chave)')
       OR (SELECT count(*) FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
            WHERE k.conrelid = v_t AND k.contype = 'f' AND cardinality(k.conkey) = 1 AND (
                  (a.attname = 'sessao_id' AND k.confrelid = 'public.fin_caixa_sessoes'::regclass AND NOT k.condeferrable)
               OR (a.attname = 'contrapartida_id' AND k.confrelid = 'public.fin_contas'::regclass AND k.condeferrable AND k.condeferred)
               OR (a.attname = 'lancamento_id' AND k.confrelid = 'public.fin_lancamentos'::regclass AND k.condeferrable AND k.condeferred))) <> 3
       OR (SELECT count(*) FROM pg_attrdef WHERE adrelid = v_t) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                       WHERE d.adrelid = v_t AND a.attname = 'criado_em' AND pg_get_expr(d.adbin, d.adrelid) = 'now()')
       OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_t)
       OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = v_t AND NOT tgisinternal)
       OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                   WHERE c.oid = v_t AND g.grantee <> c.relowner)
       OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = v_t AND attacl IS NOT NULL)
       OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'fin_caixa_movimento_tentativas') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fin_caixa_movimento_tentativas já existe com forma, RLS, ACL ou políticas divergentes.';
    END IF;
  END IF;
END $preflight_20261252$;

CREATE TABLE IF NOT EXISTS public.fin_caixa_movimento_tentativas (
  chave uuid PRIMARY KEY,
  sessao_id uuid NOT NULL REFERENCES public.fin_caixa_sessoes (id),
  autor uuid,
  tipo text NOT NULL,
  valor numeric(12, 2) NOT NULL,
  descricao text NOT NULL,
  contrapartida_id uuid NOT NULL REFERENCES public.fin_contas (id) DEFERRABLE INITIALLY DEFERRED,
  lancamento_id uuid NOT NULL REFERENCES public.fin_lancamentos (id) DEFERRABLE INITIALLY DEFERRED,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fin_caixa_movimento_tentativas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fin_caixa_movimento_tentativas FROM PUBLIC, anon, authenticated, service_role;

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

REVOKE ALL ON FUNCTION public.fin_caixa_fechar_sessao(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fin_caixa_movimentar_com_chave(uuid, uuid, text, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_caixa_fechar_sessao(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fin_caixa_movimentar_com_chave(uuid, uuid, text, numeric, text, uuid) TO authenticated, service_role;

DO $conferencia_20261252$
DECLARE
  v_t regclass := to_regclass('public.fin_caixa_movimento_tentativas');
  v_f regprocedure := to_regprocedure('public.fin_caixa_fechar_sessao(uuid,numeric,text)');
  v_m regprocedure := to_regprocedure('public.fin_caixa_movimentar_com_chave(uuid,uuid,text,numeric,text,uuid)');
  v_dono oid := (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.fin_caixa_fechar(numeric,text)'));
BEGIN
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.fin_caixa_fechar(numeric,text)'))
       IS DISTINCT FROM '69a9dd8988cdc05392f500deb64f349f'
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.fin_caixa_movimentar(text,numeric,text,uuid)'))
       IS DISTINCT FROM 'd7e8dfeec40f89dff51f4cb3ccf14b9a' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a migration mexeu no corpo das RPCs antigas do caixa.';
  END IF;
  IF v_f IS NULL OR v_m IS NULL
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('fin_caixa_fechar_sessao', 'fin_caixa_movimentar_com_chave')) <> 2
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_f) IS DISTINCT FROM 'f10208ba223450fd25af3c9e11dca073'
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_m) IS DISTINCT FROM '134bd5b7c5872bf30041601725fc37ba' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: RPCs novas do caixa ausentes ou com corpo desconhecido.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid IN (v_f, v_m) AND l.lanname = 'plpgsql' AND p.prokind = 'f'
         AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
         AND p.proconfig = ARRAY['search_path=public']::text[] AND p.proowner = v_dono
         AND pg_get_function_result(p.oid) = 'jsonb' AND p.pronargdefaults = 1) <> 2 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos das RPCs novas do caixa divergentes.';
  END IF;
  IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_f, 'EXECUTE')
     OR has_function_privilege('anon', v_f, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_m, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_m, 'EXECUTE')
     OR has_function_privilege('anon', v_m, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid IN (v_f, v_m) AND (g.grantee = 0 OR
                   (g.grantee <> p.proowner AND g.grantee NOT IN ('authenticated'::regrole, 'service_role'::regrole))
                   OR (g.grantee <> p.proowner AND g.is_grantable))) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL das RPCs novas do caixa divergente.';
  END IF;
  IF v_t IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = v_t AND relkind = 'r' AND relrowsecurity
                     AND NOT relforcerowsecurity AND relowner = v_dono)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_t)
     OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                 WHERE c.oid = v_t AND g.grantee <> c.relowner)
     OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'fin_caixa_movimento_tentativas') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fin_caixa_movimento_tentativas sem RLS ou aberta a outro papel.';
  END IF;
END $conferencia_20261252$;
