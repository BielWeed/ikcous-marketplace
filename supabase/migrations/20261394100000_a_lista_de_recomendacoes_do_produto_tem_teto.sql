-- ============================================================================
-- Migration 20261394100000 — a lista de recomendações do produto tem teto (vitrine; caçada de 27/10/2026; só LEITURA; troca o corpo de UMA função)
-- ============================================================================
--
-- 1. O DEFEITO MEDIDO
--
-- public.get_product_recommendations(p_product_id uuid, p_limit integer DEFAULT 4) é a lista "você também pode gostar" da página do
-- produto, chamada pelo visitante (anon) sem conta. O número de itens vem do chamador e ia direto para o "LIMIT p_limit": quem chama a
-- API de fora e manda 1000000 (ou NULL, que em LIMIT quer dizer "sem limite") recebe os produtos ativos com estoque da mesma categoria
-- ou das mesmas tags de uma vez só. A loja nunca precisou de mais que 4 (o padrão do front); a função não tinha teto.
--
-- 2. A REGRA NOVA
--
-- O limite aplicado é LEAST(GREATEST(COALESCE(p_limit, 4), 1), 50), o mesmo molde das outras listas da casa (teto em vez de erro):
--   * p_limit omitido: 4, como sempre;  * p_limit entre 1 e 50: o que a pessoa pediu, como sempre;
--   * p_limit acima de 50: 50 (antes: tudo);  * p_limit NULL: 4 (antes: tudo);  * p_limit 0 ou negativo: 1 (antes: 0 → nenhuma linha;
--     negativo → erro "LIMIT must not be negative"). Nenhum front manda 0 ou negativo (o padrão é 4).
--
-- 3. O QUE MUDA NO CORPO (só esta troca; o resto não muda um byte)
--
-- A linha "LIMIT p_limit;" vira "LIMIT LEAST(GREATEST(COALESCE(p_limit, 4), 1), 50);", com 3 linhas de comentário antes. A seleção, as 31
-- colunas (custo e fornecedor_id continuam saindo NULOS), o filtro, a ordenação, a assinatura, SECURITY DEFINER, VOLATILE,
-- search_path ('public'), o retorno SETOF produtos e a ACL NÃO mudam.
--
-- 4. DADOS EXISTENTES
--
-- Nenhuma linha é lida nem reescrita ao aplicar: só o corpo de UMA função muda. Aplicar duas vezes deixa o mesmo estado (o pré-voo aceita o
-- corpo vigente OU o desta migration).
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de replace(prosrc, E'\r', '')) não for UM dos dois conhecidos (o da
-- 20261160000000, 3de5b27cc17c31301249861b7921a6fe, ou o desta migration, 5e5bbe7bc7f12738a9082232ee6cfee6); os atributos não forem os de sempre; ou a ACL não for EXATAMENTE a de hoje
-- (PUBLIC não; anon, authenticated e service_role sim). Fotografa OID, dono, ACL e atributos (set_config local à transação) para o pós-voo.
--
-- 6. TRANSAÇÃO
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa): quem abre a transação é o aplicador; o pré-voo, a troca do corpo e o pós-voo caem
-- juntos ou não caem.
--
-- 7. ORDEM E ROLLBACK
--
-- Depois da 20261160000000 (o pré-voo recusa sem ela). ROLLBACK MANUAL: rollback-manual-20261394100000_a_lista_de_recomendacoes_do_produto_tem_teto.sql devolve o corpo da 20261160000000 byte a
-- byte. Este rollback vem ANTES do rollback da 20261160000000 (o dela recusa enquanto este corpo estiver no ar). A consulta 9a aceita o
-- corpo desta migration como sucessor.
--
-- 8. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.get_product_recommendations(uuid, integer)');
--      -- esperado: 5e5bbe7bc7f12738a9082232ee6cfee6.
--   2. SELECT count(*) FROM public.get_product_recommendations('<id de um produto>', 1000000); -- esperado: no máximo 50.
--   3. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/a-lista-de-recomendacoes-do-produto-tem-teto-viva.cjs (rpc-ci); portão da release: consultas 107a e 107b.
-- ============================================================================

DO $preflight_20261394100000$
DECLARE
  v_fn CONSTANT text := 'public.get_product_recommendations(uuid, integer)';
  v_oid oid := to_regprocedure('public.get_product_recommendations(uuid, integer)');
  v_hash text;
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_product_recommendations') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_product_recommendations tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN (
       '3de5b27cc17c31301249861b7921a6fe', -- corpo da 20261160000000 (vigente até aqui)
       '5e5bbe7bc7f12738a9082232ee6cfee6'  -- corpo que ESTA migration deixa — reaplicação idempotente
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261160000000) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND p.proretset
          AND NOT p.proisstrict
          AND p.pronargs = 2
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_product_id uuid, p_limit integer DEFAULT 4'
          AND pg_get_function_result(p.oid) = 'SETOF produtos'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, SETOF, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR NOT has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC não; anon, authenticated e service_role sim) — meça a loja e revise.', v_fn;
  END IF;

  -- Fotografia: OID, dono, ACL e TODOS os atributos (o CREATE OR REPLACE só pode trocar o texto).
  PERFORM set_config('ikcous.recs394_atributos', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)::text, true);
END $preflight_20261394100000$;

-- get_product_recommendations: o corpo vivo da 20261160000000 + o teto do limite (a troca declarada no cabeçalho, item 3).
CREATE OR REPLACE FUNCTION public.get_product_recommendations(p_product_id uuid, p_limit integer DEFAULT 4)
 RETURNS SETOF public.produtos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_category text;
    v_tags text[];
BEGIN
    -- Get context from current product
    SELECT categoria, tags INTO v_category, v_tags
    FROM produtos
    WHERE id = p_product_id;

    RETURN QUERY
    SELECT
        p.id,
        p.nome,
        p.descricao,
        p.categoria,
        p.codigo,
        NULL::numeric(10,2),  -- custo: nunca sai desta funcao
        p.preco_venda,
        p.estoque,
        p.estoque_minimo,
        NULL::uuid,           -- fornecedor_id: nunca sai desta funcao
        p.ativo,
        p.tags,
        p.data_cadastro,
        p.ultima_atualizacao,
        p.imagem_url,
        p.meta_title,
        p.meta_description,
        p.imagem_urls,
        p.preco_original,
        p.is_bestseller,
        p.frete_gratis,
        p.sold,
        p.deleted_at,
        p.calculated_points,
        p.rating,
        p.review_count,
        p.peso_kg,
        p.largura_cm,
        p.altura_cm,
        p.comprimento_cm,
        -- 31a coluna, a unica linha nova neste corpo: tem de existir e tem de
        -- ser a ULTIMA, porque e' a ultima coluna de `produtos`.
        p.codigo_barras
    FROM produtos p
    WHERE p.id != p_product_id
      AND p.ativo = true
      AND p.estoque > 0
      AND (
          -- Exact category match (High weight)
          p.categoria = v_category
          OR
          -- Tag overlap (Medium weight)
          p.tags && v_tags
      )
    -- Simple scoring: Category match is prioritized
    ORDER BY
        (p.categoria = v_category) DESC,
        p.data_cadastro DESC
    -- 20261394100000: o limite pedido nunca passa de 50. Antes, quem chamava de fora mandava um numero qualquer (ou NULL)
    -- e levava a tabela de produtos inteira. Mesmo molde das outras listas da casa: LEAST(GREATEST(COALESCE(x, padrao), 1), teto);
    -- NULL vale o padrao da funcao (4); 0 e negativo valem 1.
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 4), 1), 50);
END;
$function$;

DO $posvoo_20261394100000$
DECLARE
  v_oid oid := to_regprocedure('public.get_product_recommendations(uuid, integer)');
  v_hash text;
  v_src text;
  v_marca text := 'LIMIT LEAST(GREATEST(COALESCE(p_limit, 4), 1), 50);';
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POSVOO_20261394100000: public.get_product_recommendations(uuid, integer) sumiu';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')), prosrc INTO v_hash, v_src FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '5e5bbe7bc7f12738a9082232ee6cfee6' THEN
    RAISE EXCEPTION 'POSVOO_20261394100000: corpo vivo (hash %) não é o desta migration', COALESCE(v_hash, 'ausente');
  END IF;
  IF (length(v_src) - length(replace(v_src, v_marca, ''))) / length(v_marca) <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261394100000: o teto do limite não aparece exatamente uma vez';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_product_recommendations') <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261394100000: get_product_recommendations ficou com sobrecarga';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND p.proretset
          AND NOT p.proisstrict
          AND p.pronargs = 2
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_product_id uuid, p_limit integer DEFAULT 4'
          AND pg_get_function_result(p.oid) = 'SETOF produtos'
     ) THEN
    RAISE EXCEPTION 'POSVOO_20261394100000: atributos de public.get_product_recommendations(uuid, integer) mudaram';
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR NOT has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261394100000: a ACL de public.get_product_recommendations(uuid, integer) não é a de sempre (PUBLIC não; anon, authenticated e service_role sim)';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM current_setting('ikcous.recs394_atributos')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_20261394100000: atributos, dono, OID ou ACL de public.get_product_recommendations(uuid, integer) mudaram';
  END IF;
END $posvoo_20261394100000$;

-- A função é RPC chamada pelo PostgREST: recarrega o schema cache. Idempotente.
NOTIFY pgrst, 'reload schema';
