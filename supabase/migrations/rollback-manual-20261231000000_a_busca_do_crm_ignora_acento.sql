-- ============================================================================
-- Rollback manual — a busca do CRM ignora acento (20261231000000)
-- ============================================================================
-- Recria public.crm_clientes(...) com o corpo VIGENTE de antes (o da 20261199000000, byte a
-- byte: o md5 de replace(prosrc, E'\r', '') volta a ser o de antes, e a prova viva confere).
-- Assinatura, SECURITY DEFINER, STABLE, search_path e retorno são os mesmos da migration.
--
-- A ACL NÃO é tocada: CREATE OR REPLACE preserva dono e privilégios, e este arquivo não tem
-- nenhum GRANT nem REVOKE — nunca devolve EXECUTE a anon ou a PUBLIC.
--
-- COM ELE VOLTA O DEFEITO: "joao" volta a não achar "João" na aba Clientes do CRM.
--
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se a função não existir ou tiver sobrecarga; se o corpo
-- vivo não for um dos dois conhecidos (o desta migration, ou o vigente — e então rodar de novo
-- reescreve o mesmo texto); se os atributos não forem os de sempre; ou se PUBLIC/anon tiverem
-- EXECUTE ou authenticated/service_role não tiverem. A conferência final recusa se o corpo não
-- voltou ao vigente, se algum atributo mudou ou se a ACL mudou.
--
-- ORDEM: este vem ANTES do rollback da 20261199000000, se os dois forem rodados.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo
-- estado.
-- ============================================================================

DO $preflight_rollback_20261231$
DECLARE
  v_fn CONSTANT text := 'public.crm_clientes(text,text,integer,integer)';
  v_oid oid := to_regprocedure('public.crm_clientes(text,text,integer,integer)');
  v_hash text;
  r record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe — nada a devolver.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'crm_clientes') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: crm_clientes tem sobrecarga em public — revise antes de devolver o corpo vigente.';
  END IF;

  -- O corpo vivo tem de ser o desta migration (desfaz) ou o vigente (já desfeito: reescreve o mesmo texto).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.crm_clientes(text,text,integer,integer)', 'd5823a661555bcee3813ab32aeee9117', '9c4268178a50729b5f7b256b77882585')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o desta migration nem o vigente — uma redefinição posterior está no ar; revise antes de sobrescrever.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_segmento text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos — revise antes de sobrescrever.', v_fn;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % está aberta para PUBLIC — o estado de antes nunca teve PUBLIC; revise a ACL antes.', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (anon sem, authenticated e service_role com) — revise a ACL antes.', v_fn;
  END IF;
END $preflight_rollback_20261231$;

CREATE OR REPLACE FUNCTION public.crm_clientes(p_segmento text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_busca text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_digitos text;
  v_res jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  v_digitos := NULLIF(regexp_replace(COALESCE(v_busca, ''), '\D', '', 'g'), '');

  WITH compradores AS (
    SELECT c.chave, c.user_id, COALESCE(pr.full_name, c.nome) AS nome_exibido, c.whatsapp, c.email,
           c.pedidos_total AS pedidos, c.receita_total AS receita,
           CASE WHEN c.pedidos_total > 0 THEN round(c.receita_total / c.pedidos_total, 2) ELSE 0 END AS ticket_medio,
           c.primeira_compra, c.ultima_compra, c.dias_sem_comprar,
           c.r, c.f, c.m, c.segmento, c.canal_preferido,
           NULL::numeric AS valor_em_aberto, NULL::timestamptz AS cadastrado_em,
           0 AS grupo, c.ultima_compra AS ordem_data
      FROM public.crm__clientes_rfm(now()) c
      LEFT JOIN public.profiles pr ON pr.id = c.user_id
  ), nao_pagos AS (
    SELECT np.chave, np.user_id, COALESCE(pr.full_name, np.nome) AS nome_exibido, np.whatsapp, np.email,
           np.pedidos, 0::numeric AS receita, 0::numeric AS ticket_medio,
           NULL::timestamptz AS primeira_compra, np.ultimo_pedido AS ultima_compra,
           (public.fin__dia(now()) - public.fin__dia(np.ultimo_pedido))::integer AS dias_sem_comprar,
           NULL::integer AS r, NULL::integer AS f, NULL::integer AS m,
           'pediu_nao_pagou'::text AS segmento, np.canal_preferido,
           np.valor_em_aberto, NULL::timestamptz AS cadastrado_em,
           1 AS grupo, np.ultimo_pedido AS ordem_data
      FROM public.crm__pedidos_nao_pagos(now()) np
      LEFT JOIN public.profiles pr ON pr.id = np.user_id
  ), nunca AS (
    SELECT nc.chave, nc.user_id, nc.nome AS nome_exibido, nc.whatsapp, nc.email,
           0 AS pedidos, 0::numeric AS receita, 0::numeric AS ticket_medio,
           NULL::timestamptz AS primeira_compra, NULL::timestamptz AS ultima_compra,
           NULL::integer AS dias_sem_comprar,
           NULL::integer AS r, NULL::integer AS f, NULL::integer AS m,
           'nunca_comprou'::text AS segmento, NULL::text AS canal_preferido,
           NULL::numeric AS valor_em_aberto, nc.cadastrado_em,
           2 AS grupo, nc.cadastrado_em AS ordem_data
      FROM public.crm__nunca_comprou(now()) nc
  ), base AS (
    SELECT * FROM compradores
    UNION ALL SELECT * FROM nao_pagos
    UNION ALL SELECT * FROM nunca
  ), filtrado AS (
    SELECT * FROM base
     WHERE (p_segmento IS NULL OR segmento = p_segmento)
       AND (v_busca IS NULL
            OR COALESCE(nome_exibido, '') ILIKE '%' || v_busca || '%'
            OR COALESCE(email, '') ILIKE '%' || v_busca || '%'
            OR (v_digitos IS NOT NULL AND length(v_digitos) >= 4 AND COALESCE(whatsapp, '') LIKE '%' || v_digitos || '%'))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtrado),
    'clientes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'chave', b.chave, 'user_id', b.user_id, 'nome', b.nome_exibido, 'whatsapp', b.whatsapp, 'email', b.email,
        'pedidos', b.pedidos, 'receita', b.receita, 'ticket_medio', b.ticket_medio,
        'primeira_compra', b.primeira_compra, 'ultima_compra', b.ultima_compra,
        'dias_sem_comprar', b.dias_sem_comprar, 'r', b.r, 'f', b.f, 'm', b.m,
        'segmento', b.segmento, 'canal_preferido', b.canal_preferido,
        'valor_em_aberto', b.valor_em_aberto, 'cadastrado_em', b.cadastrado_em
      ) ORDER BY b.grupo ASC, b.receita DESC, b.ordem_data DESC, b.chave ASC)
      -- `, chave ASC` no fim (achado 10, revisão de risco): desempate único
      -- para a paginação por OFFSET ficar estável quando grupo/receita/data
      -- empatam entre si (comum nos grupos novos, onde receita é sempre 0).
      FROM (SELECT * FROM filtrado ORDER BY grupo ASC, receita DESC, ordem_data DESC, chave ASC
             LIMIT LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200)
            OFFSET GREATEST(COALESCE(p_offset, 0), 0)) b), '[]'::jsonb)
  ) INTO v_res;
  RETURN v_res;
END;
$$;

DO $conferencia_rollback_20261231$
DECLARE
  v_fn CONSTANT text := 'public.crm_clientes(text,text,integer,integer)';
  v_oid oid := to_regprocedure('public.crm_clientes(text,text,integer,integer)');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'd5823a661555bcee3813ab32aeee9117' THEN
    RAISE EXCEPTION 'conferencia rollback 20261231: corpo vivo de % (hash %) não voltou ao vigente', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_segmento text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'conferencia rollback 20261231: atributos de % mudaram', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia rollback 20261231: % aberta para PUBLIC — o estado de antes não tinha PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261231: ACL de % mudou', v_fn;
  END IF;
END $conferencia_rollback_20261231$;
