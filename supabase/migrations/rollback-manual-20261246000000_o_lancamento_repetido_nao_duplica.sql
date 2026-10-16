-- Rollback comum 20261246000000: restaura o corpo vigente da 20261199 byte a byte.
-- DEIXA fin_lancamento_tentativas e seus registros. Sem proteção de retry durante o rollback;
-- retirar o front novo antes. Destruição dos registros é outro arquivo, só com o dono.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261246$
DECLARE
  v_oid oid := to_regprocedure('public.fin_lancamento_salvar(jsonb)');
  v_hash text;
BEGIN
  IF v_oid IS NULL OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fin_lancamento_salvar') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fin_lancamento_salvar ausente ou com sobrecarga.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash NOT IN ('559a13a9d69e02e5048623685cd07514', '1356dbfc037a9202ef163ba598854891') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de fin_lancamento_salvar desconhecido (hash %).', v_hash;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_oid AND l.lanname = 'plpgsql' AND p.prokind = 'f'
       AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
       AND p.proconfig = ARRAY['search_path=public']::text[]
       AND pg_get_function_result(p.oid) = 'jsonb'
       AND pg_get_function_arguments(p.oid) = 'p jsonb' AND p.pronargs = 1
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de fin_lancamento_salvar divergentes.';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid AND (g.grantee = 0 OR
                   (g.grantee <> p.proowner AND g.grantee NOT IN ('authenticated'::regrole, 'service_role'::regrole))
                   OR (g.grantee <> p.proowner AND g.is_grantable))) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de fin_lancamento_salvar divergente.';
  END IF;
  IF to_regprocedure('public.is_admin()') IS NULL
     OR to_regprocedure('public.is_admin_atual()') IS NULL
     OR to_regprocedure('public.fin__hoje()') IS NULL
     OR to_regclass('public.fin_lancamentos') IS NULL
     OR to_regclass('public.fin_contas') IS NULL
     OR to_regclass('public.fin_categorias') IS NULL
     OR to_regclass('public.fin_caixa_sessoes') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta dependência do financeiro ou dos gates de admin.';
  END IF;
  IF to_regclass('public.fin_lancamento_tentativas') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.fin_lancamento_tentativas')
                    AND relkind = 'r' AND relrowsecurity AND NOT relforcerowsecurity
                    AND relowner = (SELECT proowner FROM pg_proc WHERE oid = v_oid))
       OR (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
             FROM pg_attribute a WHERE a.attrelid = to_regclass('public.fin_lancamento_tentativas') AND a.attnum > 0 AND NOT a.attisdropped)
          IS DISTINCT FROM 'chave:uuid:true,conteudo_hash:text:true,ids:uuid[]:true,criado_em:timestamp with time zone:true'
       OR (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.fin_lancamento_tentativas')) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.fin_lancamento_tentativas')
                       AND contype = 'p' AND pg_get_constraintdef(oid) = 'PRIMARY KEY (chave)')
       OR (SELECT count(*) FROM pg_attrdef WHERE adrelid = to_regclass('public.fin_lancamento_tentativas')) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                       WHERE d.adrelid = to_regclass('public.fin_lancamento_tentativas') AND a.attname = 'criado_em'
                         AND pg_get_expr(d.adbin, d.adrelid) = 'now()')
       OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.fin_lancamento_tentativas'))
       OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.fin_lancamento_tentativas') AND NOT tgisinternal)
       OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                   WHERE c.oid = to_regclass('public.fin_lancamento_tentativas') AND g.grantee <> c.relowner)
       OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.fin_lancamento_tentativas') AND attacl IS NOT NULL)
       OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'fin_lancamento_tentativas') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fin_lancamento_tentativas já existe com forma, RLS, ACL ou políticas divergentes.';
    END IF;
  END IF;
END $preflight_rollback_20261246$;

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
  RETURN jsonb_build_object('ids', to_jsonb(v_ids));
END;
$$;

DO $conferencia_rollback_20261246$
DECLARE
  v_oid oid := to_regprocedure('public.fin_lancamento_salvar(jsonb)');
  v_hash text;
BEGIN
  IF v_oid IS NULL OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fin_lancamento_salvar') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fin_lancamento_salvar ausente ou com sobrecarga.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash NOT IN ('559a13a9d69e02e5048623685cd07514') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de fin_lancamento_salvar desconhecido (hash %).', v_hash;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = v_oid AND l.lanname = 'plpgsql' AND p.prokind = 'f'
       AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proretset
       AND p.proconfig = ARRAY['search_path=public']::text[]
       AND pg_get_function_result(p.oid) = 'jsonb'
       AND pg_get_function_arguments(p.oid) = 'p jsonb' AND p.pronargs = 1
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de fin_lancamento_salvar divergentes.';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_oid AND (g.grantee = 0 OR
                   (g.grantee <> p.proowner AND g.grantee NOT IN ('authenticated'::regrole, 'service_role'::regrole))
                   OR (g.grantee <> p.proowner AND g.is_grantable))) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de fin_lancamento_salvar divergente.';
  END IF;
  IF to_regprocedure('public.is_admin()') IS NULL
     OR to_regprocedure('public.is_admin_atual()') IS NULL
     OR to_regprocedure('public.fin__hoje()') IS NULL
     OR to_regclass('public.fin_lancamentos') IS NULL
     OR to_regclass('public.fin_contas') IS NULL
     OR to_regclass('public.fin_categorias') IS NULL
     OR to_regclass('public.fin_caixa_sessoes') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta dependência do financeiro ou dos gates de admin.';
  END IF;
  IF to_regclass('public.fin_lancamento_tentativas') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.fin_lancamento_tentativas')
                    AND relkind = 'r' AND relrowsecurity AND NOT relforcerowsecurity
                    AND relowner = (SELECT proowner FROM pg_proc WHERE oid = v_oid))
       OR (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
             FROM pg_attribute a WHERE a.attrelid = to_regclass('public.fin_lancamento_tentativas') AND a.attnum > 0 AND NOT a.attisdropped)
          IS DISTINCT FROM 'chave:uuid:true,conteudo_hash:text:true,ids:uuid[]:true,criado_em:timestamp with time zone:true'
       OR (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.fin_lancamento_tentativas')) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.fin_lancamento_tentativas')
                       AND contype = 'p' AND pg_get_constraintdef(oid) = 'PRIMARY KEY (chave)')
       OR (SELECT count(*) FROM pg_attrdef WHERE adrelid = to_regclass('public.fin_lancamento_tentativas')) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                       WHERE d.adrelid = to_regclass('public.fin_lancamento_tentativas') AND a.attname = 'criado_em'
                         AND pg_get_expr(d.adbin, d.adrelid) = 'now()')
       OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.fin_lancamento_tentativas'))
       OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.fin_lancamento_tentativas') AND NOT tgisinternal)
       OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
                   WHERE c.oid = to_regclass('public.fin_lancamento_tentativas') AND g.grantee <> c.relowner)
       OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.fin_lancamento_tentativas') AND attacl IS NOT NULL)
       OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'fin_lancamento_tentativas') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: fin_lancamento_tentativas já existe com forma, RLS, ACL ou políticas divergentes.';
    END IF;
  END IF;
END $conferencia_rollback_20261246$;
