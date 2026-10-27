-- ============================================================================
-- Migration 20261395000000 — a busca de devolução acha o número do pedido (painel; só LEITURA; troca o corpo de UMA função)
-- ============================================================================
--
-- 1. O DEFEITO MEDIDO (caça 10, 27/10/2026)
--
-- public.admin_devolucoes_listar(p_status, p_busca, p_limite, p_offset) é a lista de Devoluções do painel. O campo de busca diz
-- "Protocolo, cliente ou nº do pedido", mas o pedido era comparado com o COMEÇO do id (d.order_id::text ILIKE v_busca || '%'), e o
-- número que a lojista vê e copia ("Pedido #3884BE", src/lib/numero-do-pedido.ts) são os 6 ÚLTIMOS caracteres do id, em maiúscula.
-- Resultado: digitar 3884BE (ou #3884BE) dizia "Nada encontrado" com a devolução existindo. A busca da tela de Pedidos já faz certo
-- (20261387000000: igualdade nos 6 últimos, sem caixa); a de Devoluções ficou para trás.
--
-- 2. A REGRA NOVA
--
-- Mais UM ramo no OR do filtro: upper(right(d.order_id::text, 6)) = upper(btrim(ltrim(v_busca, '#'))). Igualdade, não pedaço: "3884"
-- ou "84BE" não acham (como na tela de Pedidos), e % e _ digitados não viram curinga neste ramo. Os três ramos que já existiam
-- (protocolo, nome do cliente, começo do id) ficam EXATAMENTE como estavam: quem colava o id inteiro continua achando.
-- Desempenho: a tabela de devoluções é pequena (uma linha por pedido devolvido) e o ramo antigo (id::text ILIKE) também não usava
-- índice; right() em uuid::text por linha não muda o plano de forma mensurável.
--
-- 3. O QUE MUDA NO CORPO (só esta troca; o resto não muda um byte)
--
-- A linha "OR d.order_id::text ILIKE v_busca || '%')" vira "... '%'" sem o parêntese de fechamento, mais 3 linhas de comentário, mais o
-- ramo novo com o parêntese. A contagem por status, a paginação, as colunas, a ordenação, a assinatura, SECURITY DEFINER, STABLE,
-- search_path ('public'), as duas portas de admin (is_admin e is_admin_atual) e a ACL NÃO mudam.
--
-- 4. DADOS EXISTENTES
--
-- Nenhuma linha é lida nem reescrita ao aplicar: só o corpo de UMA função muda. Aplicar duas vezes deixa o mesmo estado (o pré-voo
-- aceita o corpo vigente OU o desta migration).
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de replace(prosrc, E'\r', '')) não for UM dos dois conhecidos
-- (o da 20261199000000, 5a632e0a239104598dcdc4eb323c09b1, ou o desta migration, 989a6c6151eb35efc7c834c6cce20f01); os atributos não forem os de sempre; ou a ACL
-- não for EXATAMENTE a de hoje (authenticated e service_role sim; anon e PUBLIC não). Fotografa OID, dono, ACL e atributos
-- (set_config local à transação) para o pós-voo.
--
-- 6. TRANSAÇÃO
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa): quem abre a transação é o aplicador; o pré-voo, a troca do corpo e o pós-voo
-- caem juntos ou não caem. lock_timeout de 5 s: trocar o corpo espera o catálogo; melhor falhar e reaplicar.
--
-- 7. ORDEM E ROLLBACK
--
-- Depois da 20261199000000 (o pré-voo recusa sem ela). ROLLBACK MANUAL: rollback-manual-20261395000000_a_busca_de_devolucao_acha_o_numero_do_pedido.sql devolve o corpo
-- da 20261199000000 byte a byte. A consulta 8e aceita o corpo desta migration como sucessor.
--
-- 8. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.admin_devolucoes_listar(text,text,integer,integer)');
--      -- esperado: 989a6c6151eb35efc7c834c6cce20f01.
--   2. Painel > Devoluções > digitar o número do pedido de uma devolução (os 6 últimos, com ou sem #): a devolução aparece.
--   3. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/a-busca-de-devolucao-acha-o-numero-do-pedido-viva.cjs (rpc-ci); portão da release: consultas 108a e 108b.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261395000000$
DECLARE
  v_fn CONSTANT text := 'public.admin_devolucoes_listar(text, text, integer, integer)';
  v_oid oid := to_regprocedure('public.admin_devolucoes_listar(text, text, integer, integer)');
  v_hash text;
  v_vigente text;
  v_desta text;
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_devolucoes_listar') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: admin_devolucoes_listar tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- vigente = o corpo da 20261199000000 (até aqui); desta = o que ESTA migration deixa (reaplicação idempotente).
  SELECT anterior, desta INTO v_vigente, v_desta FROM (VALUES
    ('public.admin_devolucoes_listar(text,text,integer,integer)', '5a632e0a239104598dcdc4eb323c09b1', '989a6c6151eb35efc7c834c6cce20f01')
  ) esperado(assinatura, anterior, desta);
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN (v_vigente, v_desta) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261199000000) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prokind = 'f'
          AND p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proisstrict
          AND p.pronargs = 4
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_status text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (authenticated e service_role sim; anon e PUBLIC não) — meça a loja e revise.', v_fn;
  END IF;

  -- Fotografia: OID, dono, ACL e TODOS os atributos (o CREATE OR REPLACE só pode trocar o texto).
  PERFORM set_config('ikcous.busca395_atributos', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)::text, true);
END $preflight_20261395000000$;

-- admin_devolucoes_listar: o corpo vivo da 20261199000000 + a troca declarada no cabeçalho (item 3).
CREATE OR REPLACE FUNCTION public.admin_devolucoes_listar(p_status text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_busca text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_limite integer := LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_total integer;
  v_itens jsonb;
  v_contagem jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'solicitada', count(*) FILTER (WHERE status = 'solicitada'),
    'aprovada', count(*) FILTER (WHERE status = 'aprovada'),
    'em_transito', count(*) FILTER (WHERE status = 'em_transito'),
    'recebida', count(*) FILTER (WHERE status = 'recebida'),
    'concluida', count(*) FILTER (WHERE status = 'concluida'),
    'recusada', count(*) FILTER (WHERE status = 'recusada'),
    'cancelada', count(*) FILTER (WHERE status = 'cancelada'),
    'reprovada', count(*) FILTER (WHERE status = 'reprovada')
  ) INTO v_contagem FROM public.devolucoes;

  WITH base AS (
    SELECT d.*, o.customer_name AS cliente_nome, o.customer_data ->> 'whatsapp' AS cliente_whatsapp
      FROM public.devolucoes d
      JOIN public.marketplace_orders o ON o.id = d.order_id
     WHERE (p_status IS NULL OR d.status = p_status)
       AND (v_busca IS NULL
            OR d.protocolo ILIKE '%' || v_busca || '%'
            OR o.customer_name ILIKE '%' || v_busca || '%'
            OR d.order_id::text ILIKE v_busca || '%'
            -- 20261395000000: o numero que o painel mostra ("Pedido #3884BE") e' o FIM do id, em maiuscula, nao o comeco.
            -- Igualdade nos 6 ultimos caracteres, sem caixa e sem o '#' da frente (a mesma regra da busca de Pedidos): nao abre
            -- a busca para pedaco de numero nem para curinga (% e _ nao valem aqui).
            OR upper(right(d.order_id::text, 6)) = upper(btrim(ltrim(v_busca, '#'))))
  )
  SELECT (SELECT count(*) FROM base),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', b.id, 'protocolo', b.protocolo, 'order_id', b.order_id,
            'cliente_nome', b.cliente_nome, 'cliente_whatsapp', b.cliente_whatsapp,
            'tipo', b.tipo, 'motivo', b.motivo, 'status', b.status,
            'resolucao_desejada', b.resolucao_desejada, 'metodo_retorno', b.metodo_retorno,
            'modalidade', b.modalidade, 'valor_itens', b.valor_itens,
            'prazo_ate', b.prazo_ate, 'created_at', b.created_at
          ) ORDER BY b.created_at DESC)
          FROM (SELECT * FROM base ORDER BY created_at DESC LIMIT v_limite OFFSET v_offset) b), '[]'::jsonb)
    INTO v_total, v_itens;

  RETURN jsonb_build_object('total', v_total, 'contagem', v_contagem, 'itens', v_itens);
END;
$$;

DO $posvoo_20261395000000$
DECLARE
  v_fn CONSTANT text := 'public.admin_devolucoes_listar(text, text, integer, integer)';
  v_oid oid := to_regprocedure('public.admin_devolucoes_listar(text, text, integer, integer)');
  v_hash text;
  v_src text;
  v_marca text := '20261395000000: o numero que o painel mostra';
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POSVOO_20261395000000: % sumiu', v_fn;
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')), prosrc INTO v_hash, v_src FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '989a6c6151eb35efc7c834c6cce20f01' THEN
    RAISE EXCEPTION 'POSVOO_20261395000000: corpo vivo (hash %) não é o desta migration', COALESCE(v_hash, 'ausente');
  END IF;
  IF (length(v_src) - length(replace(v_src, v_marca, ''))) / length(v_marca) <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261395000000: a troca desta migration não aparece exatamente uma vez';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'admin_devolucoes_listar') <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261395000000: admin_devolucoes_listar ficou com sobrecarga';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prokind = 'f'
          AND p.prosecdef
          AND p.provolatile = 's'
          AND NOT p.proisstrict
          AND p.pronargs = 4
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_status text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'POSVOO_20261395000000: atributos de % mudaram', v_fn;
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261395000000: ACL de % não é a de sempre', v_fn;
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM current_setting('ikcous.busca395_atributos')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_20261395000000: atributos, dono, OID ou ACL de % mudaram', v_fn;
  END IF;
END $posvoo_20261395000000$;

-- A função é RPC chamada pelo PostgREST: recarrega o schema cache. Idempotente.
NOTIFY pgrst, 'reload schema';
