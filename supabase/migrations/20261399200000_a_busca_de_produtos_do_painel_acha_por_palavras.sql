-- A BUSCA DE PRODUTOS DO PAINEL E DO BALCAO ACHA POR PALAVRAS, EM QUALQUER ORDEM (rodada 7; 04/11/2026).
-- DEFEITO: a busca de Produtos (lista do painel) e a busca manual do balcao rodam no banco: o front manda o texto digitado como p_search
-- para get_admin_products_paged (src/hooks/useProducts.ts; src/views/admin/AdminPdvView.tsx) e o filtro tratava a FRASE INTEIRA como um
-- trecho continuo do nome (ou do codigo, ou do SKU da variacao). "azul camiseta" nao achava "Camiseta Azul Basica", e o exemplo que a
-- propria tela do balcao mostra ("Ex.: camiseta branca P") nao achava nada: o P e' o VALOR de uma variacao (tamanho), e os valores e
-- os nomes das variacoes nunca eram comparados com texto. A lojista concluia que o produto nao existia, cadastrava duplicado ou desistia
-- de vender no balcao. A vitrine ja foi corrigida para palavra por palavra (src/lib/busca-de-produtos.ts); o painel ficou para tras.
--
-- A REGRA NOVA, SO ISTO: o texto digitado (depois do TRIM de sempre) e' quebrado em palavras (qualquer espaco em branco separa) e
-- TODAS as palavras precisam aparecer (AND), em qualquer ordem, sem diferenciar maiuscula nem acento (unaccent + ILIKE, como hoje), em
-- UM texto que junta, de cada produto: o nome, o codigo, e o SKU, o nome e o valor de cada variacao ATIVA. O texto junto e' montado UMA
-- vez por produto (OFFSET 0 impede o planejador de recalcula-lo a cada palavra). Os dois blocos da funcao (o total_count e a pagina)
-- recebem o MESMO filtro, senao a paginacao erra.
--   * Codigo de barras: continua por IGUALDADE do texto INTEIRO digitado (produtos.codigo_barras = texto, ou o de uma variacao ATIVA),
--     nunca por pedaco: um EAN pode ser prefixo de outro e o leitor do balcao manda o numero inteiro. O codigo de barras NAO entra no
--     texto junto (senao um pedaco de EAN acharia produto). E' um ramo em OU com o das palavras.
--   * UMA palavra so: acha tudo o que achava (nome, codigo, SKU de variacao ativa por pedaco) e, de brinde, o nome e o valor das
--     variacoes ativas ("P", "branco", "tamanho").
--   * Duas ou mais palavras: o que antes so achava com a frase colada passa a achar, e as palavras podem vir em outra ordem ou estar
--     em campos diferentes (nome + valor da variacao). O texto junto mistura as variacoes do produto: "azul G" acha um produto que tem
--     uma variacao azul e outra G (como a vitrine, que tambem junta os campos do produto).
--   * % e _ digitados valem como as letras que sao (a busca por "50%" acha o que tem 50% no nome): o corpo vigente os deixava agir
--     como coringa do ILIKE. A barra invertida tambem e' escapada. Troca consciente, so deixa a busca mais fiel ao que foi digitado.
--   * Texto so de espacos (ou so de tabulacao) ou NULL: sem filtro, como o texto vazio. (NULL no corpo vigente devolvia lista vazia por
--     acidente; o front manda "" por padrao e nunca NULL.)
-- As demais clausulas (categoria, status, estoque baixo, deleted_at) e o ORDER BY ficam como estao. Assinatura, retorno (data com as
-- variacoes de cada produto + total_count), SECURITY DEFINER, search_path, volatilidade, dono, OID e GRANTs (EXECUTE so authenticated e
-- service_role) NAO mudam; o gate is_admin_atual() da 20261381000000 fica no topo, intacto. O front nao muda: so passa a receber
-- resultado onde antes recebia lista vazia (ou resultado mais largo para a frase com varias palavras).
--
-- DADOS EXISTENTES: nenhuma linha e lida ou escrita ao aplicar. E so a leitura que muda. Produto sem codigo, sem SKU ou sem variacao
-- entra no texto junto sem esses pedacos (concat_ws pula NULL); produto sem codigo de barras (NULL) nunca casa (NULL = texto e NULL).
--
-- CORPO VIGENTE: o da 20261385000000 (md5 39db382689def5fac3b263a66f84ede1); o corpo desta migration tem md5 346063e900b8b7b63dfbeffe5070eedc.
-- PRE-VOO fail-closed: aceita SO o corpo da 20261385 ou o desta (reaplicar e inofensivo), mais atributos, dono, ACL e uma assinatura so;
-- exige tambem as colunas que o filtro novo le (plpgsql nao valida coluna ao criar a funcao: sem elas a lista inteira passaria a falhar
-- em toda chamada). Loja que ainda nao recebeu a 20261385 e recusada de proposito: aplicar na ordem. POS-VOO: hash novo e fotografia de
-- TODOS os atributos tirada antes igual a de depois (so o texto muda). Sem BEGIN/COMMIT de nivel superior: o aplicador fornece a
-- transacao inteira (AGENTS.md); se qualquer verificacao falhar, nada fica gravado.
-- ORDEM: depois da 20261385000000. COMPORTAMENTO: tests/banco/a-busca-do-painel-acha-por-palavras-viva.cjs (so CI efemero).
-- ROLLBACK MANUAL: rollback-manual-20261399200000_a_busca_de_produtos_do_painel_acha_por_palavras.sql devolve o corpo da 20261385
-- byte a byte (LF, sem CR); recusa corpo desconhecido e segundo rollback. Desfazer a 20261385 exige desfazer esta ANTES (o rollback da
-- 85 so aceita o corpo dela).
--

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399200$
DECLARE
  r record;
  v_hash text;
  v_atributos jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.get_admin_products_paged(text,text,text,text,integer,integer)', '39db382689def5fac3b263a66f84ede1', '346063e900b8b7b63dfbeffe5070eedc')
  ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos FROM pg_proc p
     WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) nao e o corpo vigente (20261385) nem o desta migration; revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = to_regprocedure(r.assinatura)
         AND p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
         AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
         AND p.proparallel = 'u' AND p.procost = 100
         AND l.lanname = 'plpgsql' AND p.prorettype = 'jsonb'::regtype
         AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_category text DEFAULT ''all''::text, p_status text DEFAULT ''all''::text, p_stock text DEFAULT ''all''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10'
         AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))
         AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_products_paged') = 1
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_products_paged tem assinatura, atributos, dono ou permissoes diferentes dos esperados.';
    END IF;
    -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
    PERFORM set_config('ikcous.busca3992_atributos', v_atributos::text, true);
  END LOOP;
  -- As colunas que o filtro novo le. plpgsql NAO valida coluna ao criar a funcao: sem esta guarda, uma loja sem elas aceitaria o
  -- CREATE e a lista inteira de Produtos passaria a falhar em TODA chamada.
  IF (SELECT count(*) FROM pg_attribute a
       WHERE NOT a.attisdropped
         AND ((a.attrelid = to_regclass('public.produtos') AND a.attname IN ('nome', 'codigo', 'codigo_barras') AND a.atttypid = 'text'::regtype)
           OR (a.attrelid = to_regclass('public.product_variants') AND a.attname IN ('name', 'value', 'sku', 'codigo_barras') AND a.atttypid = 'text'::regtype)
           OR (a.attrelid = to_regclass('public.product_variants') AND a.attname = 'active' AND a.atttypid = 'boolean'::regtype)
           OR (a.attrelid = to_regclass('public.product_variants') AND a.attname = 'product_id' AND a.atttypid = 'uuid'::regtype))) <> 9 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: produtos (nome, codigo, codigo_barras) e product_variants (name, value, sku, codigo_barras, active, product_id) precisam existir com o tipo esperado; nada foi alterado.';
  END IF;
END $preflight_20261399200$;

CREATE OR REPLACE FUNCTION public.get_admin_products_paged(p_search text DEFAULT ''::text, p_category text DEFAULT 'all'::text, p_status text DEFAULT 'all'::text, p_stock text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
    v_padroes TEXT[];
BEGIN
    -- Authorization check
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

    -- Palavra por palavra: cada palavra do texto vira um padrao de ILIKE sem acento, com % e _ e a barra invertida escapados
    -- (valem como as letras que sao). Texto vazio, so de espacos ou NULL: nenhum padrao, nenhum filtro.
    SELECT COALESCE(array_agg('%' || replace(replace(replace(unaccent(w.palavra), chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_') || '%'), '{}'::TEXT[])
      INTO v_padroes
      FROM regexp_split_to_table(COALESCE(v_clean_search, ''), '[[:space:]]+') AS w(palavra)
     WHERE w.palavra <> '';

    -- Compute total count with filters (before pagination)
    SELECT COUNT(p.id) INTO v_total_count
    FROM public.produtos p
    WHERE p.deleted_at IS NULL
      AND (p_category = 'all' OR p.categoria = p_category)
      AND (p_status = 'all' OR (p_status = 'active' AND p.ativo = TRUE) OR (p_status = 'inactive' AND p.ativo = FALSE))
      AND (p_stock = 'all' OR (p_stock = 'low' AND (CASE WHEN EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) THEN (SELECT COALESCE(sum(COALESCE(pv.stock_increment, 0)), 0) FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) ELSE p.estoque END) <= COALESCE(p.estoque_minimo, 5)))
      AND (
        cardinality(v_padroes) = 0 OR
        -- Codigo de barras: IGUALDADE do texto inteiro (um EAN pode ser prefixo de outro), do produto ou de uma variacao ATIVA.
        p.codigo_barras = v_clean_search OR
        EXISTS (
          SELECT 1 FROM public.product_variants vc
           WHERE vc.product_id = p.id AND vc.active AND vc.codigo_barras = v_clean_search
        ) OR
        -- TODAS as palavras no texto junto do produto: nome, codigo e SKU, nome e valor das variacoes ATIVAS (montado uma vez por produto).
        EXISTS (
          SELECT 1
            FROM (SELECT unaccent(concat_ws(' ', p.nome, p.codigo, (SELECT string_agg(concat_ws(' ', vt.sku, vt.name, vt.value), ' ') FROM public.product_variants vt WHERE vt.product_id = p.id AND vt.active))) AS texto OFFSET 0) t
           WHERE NOT EXISTS (SELECT 1 FROM unnest(v_padroes) AS w(padrao) WHERE t.texto NOT ILIKE w.padrao)
        )
      );

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            p.*,
            (
                SELECT COALESCE(
                    jsonb_agg(to_jsonb(v.*)),
                    '[]'::JSONB
                )
                FROM public.product_variants v
                WHERE v.product_id = p.id
            ) AS product_variants
        FROM public.produtos p
        WHERE p.deleted_at IS NULL
          AND (p_category = 'all' OR p.categoria = p_category)
          AND (p_status = 'all' OR (p_status = 'active' AND p.ativo = TRUE) OR (p_status = 'inactive' AND p.ativo = FALSE))
          AND (p_stock = 'all' OR (p_stock = 'low' AND (CASE WHEN EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) THEN (SELECT COALESCE(sum(COALESCE(pv.stock_increment, 0)), 0) FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) ELSE p.estoque END) <= COALESCE(p.estoque_minimo, 5)))
          AND (
            cardinality(v_padroes) = 0 OR
            -- Codigo de barras: IGUALDADE do texto inteiro (um EAN pode ser prefixo de outro), do produto ou de uma variacao ATIVA.
            p.codigo_barras = v_clean_search OR
            EXISTS (
              SELECT 1 FROM public.product_variants vc
               WHERE vc.product_id = p.id AND vc.active AND vc.codigo_barras = v_clean_search
            ) OR
            -- TODAS as palavras no texto junto do produto: nome, codigo e SKU, nome e valor das variacoes ATIVAS (montado uma vez por produto).
            EXISTS (
              SELECT 1
                FROM (SELECT unaccent(concat_ws(' ', p.nome, p.codigo, (SELECT string_agg(concat_ws(' ', vt.sku, vt.name, vt.value), ' ') FROM public.product_variants vt WHERE vt.product_id = p.id AND vt.active))) AS texto OFFSET 0) t
               WHERE NOT EXISTS (SELECT 1 FROM unnest(v_padroes) AS w(padrao) WHERE t.texto NOT ILIKE w.padrao)
            )
          )
        ORDER BY p.data_cadastro DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );
END;
$function$;

DO $conferencia_20261399200$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_admin_products_paged(text,text,text,text,integer,integer)')
      AND md5(replace(p.prosrc, E'\r', '')) = '346063e900b8b7b63dfbeffe5070eedc'
      AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.busca3992_atributos')::jsonb
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261399200 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_20261399200$;

NOTIFY pgrst, 'reload schema';
