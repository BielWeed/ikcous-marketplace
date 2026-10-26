-- ============================================================================
-- Migration 20261392100000 — a busca do CRM acha o número colado com o +55
-- (dado de cliente; caçada de 26/10/2026; só LEITURA)
-- ============================================================================
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- public.crm_clientes(...) é a lista da aba Clientes do CRM. A busca por número compara os DÍGITOS
-- do que a lojista digitou com o WhatsApp da cliente (que no CRM já é só dígitos). Quem colava o
-- número do WhatsApp com o código do país ("+55 34 99999-1234" vira "5534999991234") não achava a
-- cliente guardada como "34999991234": o 55 a mais impedia o "contém". A busca de clientes da tela
-- Clientes já tira o 55 desde a 20261230000000; só esta lista não tirava.
--
-- 2. A REGRA NOVA (a mesma da 20261230000000)
--
-- Com 12 ou 13 dígitos começando por 55 (o +55 do Brasil), o 55 sai ANTES de comparar. Um WhatsApp
-- guardado COM o 55 também casa (a comparação continua sendo "contém"). Menos de 4 dígitos, termo sem
-- dígito, nome, e-mail e filtro de segmento: nada muda.
--
-- 3. O QUE MUDA NO CORPO (só esta troca; o resto não muda um byte)
--
--   depois da linha que calcula v_digitos, três linhas de comentário e o IF que corta o 55.
-- Assinatura, SECURITY DEFINER, STABLE, search_path ('public'), retorno (jsonb), as duas travas de
-- admin (is_admin e is_admin_atual), a comparação sem acento da 20261231000000, a união dos três
-- grupos, a ordenação (com o desempate por chave), a paginação e o formato do JSON NÃO mudam. A ACL
-- NÃO é tocada (PUBLIC não, anon não, authenticated sim, service_role sim, como hoje).
--
-- 4. O QUE ACONTECE EM CADA CASO
--
--   * "+55 34 99999-1234", "5534999991234", "55 34 99999 1234" acham a cliente "34999991234";
--   * "34999991234" e "999991234" continuam achando, como antes;
--   * cliente guardada COM o 55 ("5534999991234") continua achada pelos dois jeitos de digitar;
--   * DDD 55 (Santa Maria/RS) com 11 dígitos ("55999991234") NÃO perde o 55: é o DDD, não o país;
--   * 12 dígitos que NÃO começam por 55 não se cortam;
--   * menos de 4 dígitos, nome, e-mail, busca vazia: como antes.
--
-- 5. QUEM LÊ
--
-- src/lib/crm.ts e a aba Clientes do CRM (src/views/admin/AdminCrmView.tsx): o formato do JSON é o
-- mesmo. Nenhum front e nenhuma edge function mudam.
--
-- 6. DADOS EXISTENTES
--
-- Nenhuma linha é lida para decidir nem reescrita ao aplicar: só o corpo de UMA função muda.
--
-- 7. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de replace(prosrc, E'\r',
-- '')) não for UM dos dois conhecidos (o da 20261231000000 ou o desta migration); os atributos não
-- forem os de sempre; ou a ACL não for EXATAMENTE a de hoje. Os hashes são o md5 REAL dos corpos,
-- amarrados ao texto por tests/migration_a_busca_do_crm_acha_o_numero_com_mais_55_test.ts.
--
-- 8. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Dois estados de entrada: corpo da 20261231000000 (aplica) ou corpo desta migration (reaplicar
-- reescreve o MESMO texto). Qualquer outro estado ABORTA. Sem BEGIN/COMMIT de nível superior (regra
-- da casa): quem abre a transação é o aplicador; o pré-voo, a troca do corpo e a conferência final
-- caem juntos ou não caem.
--
-- 9. ORDEM E ROLLBACK
--
-- Depois da 20261231000000 (o pré-voo recusa sem ela; a CADEIA 99 → 231 → esta: o `hash_vigente`
-- daqui é o `hash_desta` da 231). Independe da 20261392000000 (outra função). ROLLBACK MANUAL:
-- rollback-manual-20261392100000_a_busca_do_crm_acha_o_numero_com_mais_55.sql devolve o corpo da
-- 20261231000000 byte a byte. Este rollback vem ANTES do rollback da 20261231000000 (o da 231 recusa
-- enquanto este corpo estiver no ar). A 8e (lote 92-202) e a 32a aceitam este corpo como sucessor
-- do da 231.
--
-- 10. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.crm_clientes(text,text,integer,integer)');
--      -- esperado: 39a2a6de59041e09b6f1e466a6782dca.
--   2. Como admin: public.crm_clientes(NULL, '+55 34 99999-1234', 50, 0) acha a cliente "34999991234".
--   3. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/a-busca-do-crm-acha-o-numero-com-mais-55-viva.cjs (rpc-ci); portão da
--   release: consultas 102a e 102b.
-- ============================================================================

DO $preflight_20261392100000$
DECLARE
  v_fn CONSTANT text := 'public.crm_clientes(text,text,integer,integer)';
  v_oid oid := to_regprocedure('public.crm_clientes(text,text,integer,integer)');
  v_hash text;
  v_public boolean;
  v_anon boolean;
  v_auth boolean;
  v_servico boolean;
  r record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'crm_clientes') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: crm_clientes tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- Corpo identificado pelo CONTEÚDO: o vigente (o da 20261231000000, aplica) ou o desta migration (reaplicar é no-op).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.crm_clientes(text,text,integer,integer)', '9c4268178a50729b5f7b256b77882585', '39a2a6de59041e09b6f1e466a6782dca')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261231000000) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- Atributos que o CREATE OR REPLACE reescreve: têm de ser os de sempre.
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
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  -- ACL exatamente a de hoje (PUBLIC medido por aclexplode, grantee = 0): o CREATE OR REPLACE a preserva.
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
  v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  v_servico := has_function_privilege('service_role', v_oid, 'EXECUTE');
  IF NOT (NOT v_public AND NOT v_anon AND v_auth AND v_servico) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC=%, anon=%, authenticated=%, service_role=%) — meça a loja e revise.', v_fn, v_public, v_anon, v_auth, v_servico;
  END IF;
END $preflight_20261392100000$;

-- crm_clientes: corpo vigente da 20261231000000_a_busca_do_crm_ignora_acento.sql, com o corte do 55
-- dos dígitos da busca (a troca declarada no cabeçalho, item 3).
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
  -- Com 12 ou 13 digitos que comecam por 55 (o +55 do Brasil colado do WhatsApp), o 55 sai antes de
  -- comparar: o WhatsApp do CRM e so digitos e o cadastro guarda o numero sem o 55 (a mesma regra da busca
  -- de clientes, 20261230000000). Um numero guardado COM o 55 continua casando (a comparacao e 'contem').
  IF length(v_digitos) IN (12, 13) AND left(v_digitos, 2) = '55' THEN
    v_digitos := substr(v_digitos, 3);
  END IF;

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
            -- Sem acento nos dois lados (f_unaccent, a mesma da busca de pedidos):
            -- "joao" acha "João" e "Joao" acha "João".
            OR public.f_unaccent(COALESCE(nome_exibido, '')) ILIKE public.f_unaccent('%' || v_busca || '%')
            OR public.f_unaccent(COALESCE(email, '')) ILIKE public.f_unaccent('%' || v_busca || '%')
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

-- CONFERÊNCIA no instante do apply: aborta se o corpo vivo não é o novo, se algum atributo
-- mudou, ou se a ACL não ficou PUBLIC não, anon não, authenticated sim, service_role sim.
DO $conferencia_20261392100000$
DECLARE
  v_fn CONSTANT text := 'public.crm_clientes(text,text,integer,integer)';
  v_oid oid := to_regprocedure('public.crm_clientes(text,text,integer,integer)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'conferencia 20261392100000: % sumiu', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'crm_clientes') <> 1 THEN
    RAISE EXCEPTION 'conferencia 20261392100000: crm_clientes ficou com sobrecarga';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '39a2a6de59041e09b6f1e466a6782dca' THEN
    RAISE EXCEPTION 'conferencia 20261392100000: corpo vivo de % (hash %) não é o desta migration', v_fn, COALESCE(v_hash, 'ausente');
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
    RAISE EXCEPTION 'conferencia 20261392100000: atributos de % mudaram', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261392100000: % alcançável por PUBLIC', v_fn;
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261392100000: anon executa %', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261392100000: authenticated perdeu EXECUTE em %', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia 20261392100000: service_role perdeu EXECUTE em %', v_fn;
  END IF;
END $conferencia_20261392100000$;
