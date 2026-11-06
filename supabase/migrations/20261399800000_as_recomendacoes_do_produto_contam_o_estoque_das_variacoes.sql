-- ============================================================================
-- Migration 20261399800000 — as recomendações do produto contam o estoque das variações (lote 124; vitrine; só LEITURA; troca o corpo de UMA função)
-- ============================================================================
--
-- 1. O DEFEITO MEDIDO
--
-- public.get_product_recommendations(p_product_id uuid, p_limit integer DEFAULT 4) é a faixa "Você também pode gostar" da página do produto,
-- chamada pelo visitante (anon) sem conta. Ela filtra "p.estoque > 0" na COLUNA CRUA do produto e corta em LIMIT 4 (o padrão do front) no
-- servidor. Só que produto com variação (tamanho, cor) guarda o estoque nas variações (product_variants.stock_increment): a venda e a
-- devolução só mexem na variação, e a coluna produtos.estoque fica velha. Resultado, os dois sentidos do mesmo erro:
--   * o produto ESGOTADO (coluna 2, variações ativas somando 0) ocupa uma das 4 vagas da faixa;
--   * o produto COM estoque (coluna 0, variação ativa com saldo) nem entra na lista.
-- O front reordena o que recebe (o disponível antes do esgotado, useProducts.fetchRecommendations), mas só sobre as linhas que o servidor já
-- escolheu: quem ficou de fora do LIMIT não volta.
--
-- 2. A REGRA NOVA (a que a vitrine e o painel já usam: src/lib/mappers.ts e o cabeçalho da 20260902000000)
--
-- Se o produto tem ao menos UMA variação ATIVA, o estoque é a soma de stock_increment das variações ATIVAS (NULL vale 0); senão, é a coluna
-- produtos.estoque. "Ativa" é active = true (active NULL conta como não ativa, como o front). O produto entra na faixa quando esse estoque é
-- maior que zero.
--   * coluna 2 + variações ativas somando 0   -> SAI (antes ocupava vaga);
--   * coluna 0 + variação ativa com saldo      -> ENTRA (antes nem entrava);
--   * produto sem variação                      -> a coluna, como sempre;
--   * variação INATIVA não conta (nem soma, nem faz o produto "ter variação"): produto só com variação inativa usa a coluna.
--
-- 3. O QUE MUDA NO CORPO (só esta troca; o resto não muda um byte)
--
-- A linha "AND p.estoque > 0" vira o CASE acima (com 3 linhas de comentário antes). A seleção, as 31 colunas (custo e fornecedor_id continuam
-- saindo NULOS; a coluna estoque devolvida segue sendo a crua do produto, o contrato SETOF produtos não muda — o front soma as variações ele
-- mesmo), o filtro de ativo e de categoria/tags, a ordenação, o teto do limite (50, NULL vale 4), a assinatura, SECURITY DEFINER, VOLATILE,
-- search_path ('public'), o retorno SETOF produtos e a ACL NÃO mudam.
--
-- 4. DADOS EXISTENTES
--
-- Nenhuma linha é reescrita ao aplicar: só o corpo de UMA função muda (o pós-voo chama a função uma vez, com um id que não existe, só para o
-- Postgres compilar o corpo novo contra product_variants; devolve zero linhas e nada é gravado). O que muda é o que a função RESPONDE: produto
-- com grade passa a ser julgado pela soma das variações ativas, e não pela coluna velha. Produto sem variação responde igual a antes.
-- Aplicar duas vezes deixa o mesmo estado (o pré-voo aceita o corpo vigente OU o desta migration).
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de replace(prosrc, E'\r', '')) não for UM dos dois conhecidos (o da
-- 20261394100000, 5e5bbe7bc7f12738a9082232ee6cfee6, ou o desta migration, 9b9fa184eb3984e8afd3ec0f80a086e7; o corpo da 20261160000000 é recusado: aplique a 20261394100000 antes); os atributos não
-- forem os de sempre; o dono da função não for o dono de produtos e de product_variants; a ACL não for EXATAMENTE a de hoje (PUBLIC não; anon,
-- authenticated e service_role sim); ou product_variants não tiver product_id (uuid), active (boolean) e stock_increment (integer) — um corpo
-- plpgsql que cita coluna que não existe só falha na primeira chamada, então a migration confere antes. Fotografa OID, dono, ACL e atributos
-- (set_config local à transação) para o pós-voo.
--
-- 6. TRANSAÇÃO
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa): quem abre a transação é o aplicador; o pré-voo, a troca do corpo e o pós-voo caem juntos
-- ou não caem.
--
-- 7. ORDEM E ROLLBACK
--
-- Depois da 20261394100000 (o pré-voo recusa sem ela). ROLLBACK MANUAL: rollback-manual-20261399800000_as_recomendacoes_do_produto_contam_o_estoque_das_variacoes.sql devolve o corpo da
-- 20261394100000 byte a byte. Este rollback vem ANTES do rollback da 20261394100000 (o dela recusa enquanto este corpo estiver no ar). As
-- consultas 107a e 9a aceitam o corpo desta migration como sucessor.
--
-- 8. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.get_product_recommendations(uuid, integer)');
--      -- esperado: 9b9fa184eb3984e8afd3ec0f80a086e7.
--   2. SELECT count(*) FROM public.get_product_recommendations('<id de um produto com grade esgotada na categoria>', 50); -- esperado: sem o esgotado.
--   3. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/as-recomendacoes-do-produto-contam-o-estoque-das-variacoes-viva.cjs (rpc-ci); portão da release: consultas 124a e 124b.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399800000$
DECLARE
  v_fn CONSTANT text := 'public.get_product_recommendations(uuid, integer)';
  v_oid oid := to_regprocedure('public.get_product_recommendations(uuid, integer)');
  v_hash text;
  v_dono oid;
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_product_recommendations') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_product_recommendations tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')), proowner INTO v_hash, v_dono FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN (
       '5e5bbe7bc7f12738a9082232ee6cfee6', -- corpo da 20261394100000 (vigente até aqui)
       '9b9fa184eb3984e8afd3ec0f80a086e7'  -- corpo que ESTA migration deixa — reaplicação idempotente
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261394100000) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
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

  -- SECURITY DEFINER lê produtos e product_variants com os privilégios do dono: o dono tem de ser o mesmo das duas tabelas.
  IF to_regclass('public.produtos') IS NULL OR to_regclass('public.product_variants') IS NULL
     OR v_dono IS DISTINCT FROM (SELECT c.relowner FROM pg_class c WHERE c.oid = to_regclass('public.produtos'))
     OR v_dono IS DISTINCT FROM (SELECT c.relowner FROM pg_class c WHERE c.oid = to_regclass('public.product_variants')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o dono de % não é o dono de produtos e de product_variants — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  -- O corpo novo cita product_variants.product_id, .active e .stock_increment: plpgsql só acusa coluna ausente na primeira chamada.
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.product_variants') AND a.attnum > 0 AND NOT a.attisdropped
         AND ((a.attname = 'product_id' AND a.atttypid = 'uuid'::regtype)
           OR (a.attname = 'active' AND a.atttypid = 'boolean'::regtype)
           OR (a.attname = 'stock_increment' AND a.atttypid = 'integer'::regtype))) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: product_variants não tem product_id (uuid), active (boolean) e stock_increment (integer) — meça a loja e revise antes de aplicar.';
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
  PERFORM set_config('ikcous.recs3998_atributos', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)::text, true);
END $preflight_20261399800000$;

-- get_product_recommendations: o corpo vivo da 20261394100000 + o estoque das variações ativas (a troca declarada no cabeçalho, item 3).
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
      -- 20261399800000: o estoque que decide a vaga e' o que a vitrine mostra (src/lib/mappers.ts): com ao menos uma variacao ATIVA,
      -- a soma de stock_increment das variacoes ativas (venda e devolucao so mexem nelas; a coluna produtos.estoque fica velha);
      -- sem variacao ativa, a coluna do produto. Antes: sempre a coluna crua, e o esgotado com grade tomava a vaga de quem tem saldo.
      AND CASE WHEN EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND v.active) THEN (SELECT COALESCE(SUM(v.stock_increment),0) FROM public.product_variants v WHERE v.product_id = p.id AND v.active) ELSE p.estoque END > 0
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

DO $posvoo_20261399800000$
DECLARE
  v_oid oid := to_regprocedure('public.get_product_recommendations(uuid, integer)');
  v_hash text;
  v_src text;
  v_marca text := 'ELSE p.estoque END > 0';
  v_filtro_velho text := 'AND p.estoque > 0';
  v_teto text := 'LIMIT LEAST(GREATEST(COALESCE(p_limit, 4), 1), 50);';
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POSVOO_20261399800000: public.get_product_recommendations(uuid, integer) sumiu';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')), prosrc INTO v_hash, v_src FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '9b9fa184eb3984e8afd3ec0f80a086e7' THEN
    RAISE EXCEPTION 'POSVOO_20261399800000: corpo vivo (hash %) não é o desta migration', COALESCE(v_hash, 'ausente');
  END IF;
  IF (length(v_src) - length(replace(v_src, v_marca, ''))) / length(v_marca) <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261399800000: o estoque das variações não aparece exatamente uma vez';
  END IF;
  IF position(v_filtro_velho IN v_src) > 0 THEN
    RAISE EXCEPTION 'POSVOO_20261399800000: o filtro antigo sobre a coluna crua ainda está no corpo';
  END IF;
  IF (length(v_src) - length(replace(v_src, v_teto, ''))) / length(v_teto) <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261399800000: o teto do limite não aparece exatamente uma vez';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_product_recommendations') <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261399800000: get_product_recommendations ficou com sobrecarga';
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
    RAISE EXCEPTION 'POSVOO_20261399800000: atributos de public.get_product_recommendations(uuid, integer) mudaram';
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR NOT has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261399800000: a ACL de public.get_product_recommendations(uuid, integer) não é a de sempre (PUBLIC não; anon, authenticated e service_role sim)';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM current_setting('ikcous.recs3998_atributos')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_20261399800000: atributos, dono, OID ou ACL de public.get_product_recommendations(uuid, integer) mudaram';
  END IF;
  -- Fumaça: um id que não existe devolve zero linhas, mas obriga o Postgres a compilar o corpo novo contra product_variants agora (e não na vitrine).
  PERFORM count(*) FROM public.get_product_recommendations('00000000-0000-0000-0000-000000000000'::uuid, 1);
END $posvoo_20261399800000$;

-- A função é RPC chamada pelo PostgREST: recarrega o schema cache. Idempotente.
NOTIFY pgrst, 'reload schema';
