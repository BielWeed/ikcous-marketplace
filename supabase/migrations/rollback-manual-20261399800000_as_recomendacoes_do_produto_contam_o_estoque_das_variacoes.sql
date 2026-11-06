-- ============================================================================
-- Rollback manual — as recomendações do produto contam o estoque das variações (20261399800000)
-- ============================================================================
-- Recria public.get_product_recommendations(uuid, integer) com o corpo VIGENTE de antes (o da 20261394100000, byte a byte: o md5 de
-- replace(prosrc, E'\r', '') volta a ser 5e5bbe7bc7f12738a9082232ee6cfee6). Assinatura, SECURITY DEFINER, VOLATILE, search_path, SETOF produtos e ACL são os
-- mesmos; OID e dono não mudam (CREATE OR REPLACE). Nenhum GRANT nem REVOKE neste arquivo.
--
-- COM ELE VOLTA O DEFEITO: o filtro volta a olhar a coluna crua do produto (o esgotado com grade ocupa vaga; o que tem saldo só na variação some da faixa).
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se a função não existir ou tiver sobrecarga; se o corpo vivo não for o DESTA migration
-- (rodar de novo, já desfeito, recusa); se os atributos não forem os de sempre; ou se a ACL não for a conhecida. O pós-voo recusa se o
-- corpo não voltou ao vigente ou se OID, dono, ACL ou atributos mudaram.
--
-- ORDEM: este vem ANTES do rollback da 20261394100000, se os dois forem rodados. Executar pelo aplicar-migrations.yml (apaga o registro do
-- ledger na mesma transação). Sem BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261399800000$
DECLARE
  v_fn CONSTANT text := 'public.get_product_recommendations(uuid, integer)';
  v_oid oid := to_regprocedure('public.get_product_recommendations(uuid, integer)');
  v_hash text;
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % ausente; nada a reverter.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_product_recommendations') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_product_recommendations tem sobrecarga em public — meça a loja e revise antes de seguir.';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '9b9fa184eb3984e8afd3ec0f80a086e7' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) não é o da 20261399800000; revise antes de reverter.', v_fn, COALESCE(v_hash, 'ausente');
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
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos — revise antes de sobrescrever.', v_fn;
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR NOT has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (PUBLIC não; anon, authenticated e service_role sim) — revise antes de sobrescrever.', v_fn;
  END IF;
  PERFORM set_config('ikcous.recs3998_rb_atributos', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)::text, true);
END $preflight_rollback_20261399800000$;

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

DO $posvoo_rollback_20261399800000$
DECLARE
  v_oid oid := to_regprocedure('public.get_product_recommendations(uuid, integer)');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '5e5bbe7bc7f12738a9082232ee6cfee6' THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261399800000: corpo vivo (hash %) não voltou ao vigente', COALESCE(v_hash, 'ausente');
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM current_setting('ikcous.recs3998_rb_atributos')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261399800000: atributos, dono, OID ou ACL de public.get_product_recommendations(uuid, integer) mudaram';
  END IF;
END $posvoo_rollback_20261399800000$;

NOTIFY pgrst, 'reload schema';
