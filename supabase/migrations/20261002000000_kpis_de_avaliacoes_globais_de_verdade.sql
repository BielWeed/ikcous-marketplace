-- KPIs de Avaliacoes "Global"/"no total" passam a ser GLOBAIS de verdade.
--
-- Achado 5 da auditoria de reviews (degrau 1; veredicto ABERTO no
-- levantamento de 25/08, autorizado na divisao da mesa 1930): as quatro
-- metricas (total, media, verificadas, respondidas) eram calculadas
-- DENTRO do mesmo WHERE do filtro de estrelas/busca - os cartoes escritos
-- "Global"/"no total" mudavam com o filtro, e filtro vazio mostrava
-- "100% verificadas" com "0 no total" na mesma caixa.
--
-- Referencia de como se faz certo (citada pela propria auditoria): a tela
-- irma de Perguntas busca os totais em consulta propria sem filtro.
-- Aqui a mesma regra, dentro da RPC: as filtradas continuam (o paginador
-- depende delas), e ganham irmas globais SEM o WHERE, devolvidas como
-- global_*.
--
-- Definicao VERBATIM da vigente (baseline) com tres insercoes cirurgicas
-- (declaracao, consulta global, retorno) - conferido por script antes de
-- gravar. Front usa os campos novos; sem custo para chamadores antigos.
-- Expand puro: so adiciona campos ao json de retorno.
--
-- SEM BEGIN/COMMIT. Faixa 20261000* (cacador-b-dorso, _REGRAS.md).
-- NAO aplicar sem prova de ROLLBACK e sem o Gabriel autorizar NESTA sessao.
--
-- FICHA DE VERIFICACAO pos-aplicacao (por consulta, nunca por tela):
--   SELECT (rpc com p_rating='1' e p_rating='all').global_total_count
--     -> os DOIS devem devolver o MESMO numero (o global nao segue filtro)
--   E controle negativo: total_count continua DIFERINDO entre as chamadas.

-- CORRECAO (fila 1935, item 1/2): CREATE OR REPLACE, nunca CREATE cru
-- nem DROP+CREATE - a funcao JA EXISTE no banco (CREATE falharia no
-- apply) e o OR REPLACE preserva os grants de EXECUTE (anon/authenticated)
-- que um DROP+CREATE perderia em silencio.

CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged("p_search" "text" DEFAULT ''::"text", "p_rating" "text" DEFAULT 'all'::"text", "p_page" integer DEFAULT 0, "p_page_size" integer DEFAULT 10) RETURNS "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
    v_rating_val INTEGER;
    
    -- Metrics
    v_average_rating NUMERIC;
    v_total_verified BIGINT;
    v_total_replied BIGINT;
    -- Globais de verdade (achado 5 da auditoria): mesmas metricas SEM o
    -- WHERE do filtro - os cartoes "Global/no total" param de seguir o filtro.
    v_global_total_count BIGINT;
    v_global_average_rating NUMERIC;
    v_global_total_verified BIGINT;
    v_global_total_replied BIGINT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);
    
    IF p_rating = 'all' THEN
        v_rating_val := NULL;
    ELSE
        v_rating_val := p_rating::INTEGER;
    END IF;

    -- Compute total count and metrics in a single query block
    SELECT 
        COUNT(r.id),
        COALESCE(AVG(r.rating), 0.0),
        COUNT(CASE WHEN r.verified = true THEN 1 END),
        COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)
    INTO 
        v_total_count,
        v_average_rating,
        v_total_verified,
        v_total_replied
    FROM public.reviews r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN public.produtos prod ON prod.id = r.product_id
    WHERE (v_rating_val IS NULL OR r.rating = v_rating_val)
      AND (
        v_clean_search = '' OR (
          unaccent(r.comment) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
        )
      );

    -- Metricas GLOBAIS (sem filtro) - irmas das filtradas acima
    SELECT
        COUNT(r.id),
        COALESCE(AVG(r.rating), 0.0),
        COUNT(CASE WHEN r.verified = true THEN 1 END),
        COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)
    INTO
        v_global_total_count,
        v_global_average_rating,
        v_global_total_verified,
        v_global_total_replied
    FROM public.reviews r;

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            r.*,
            (
                SELECT jsonb_build_object('full_name', p.full_name)
                FROM public.profiles p
                WHERE p.id = r.user_id
            ) AS "user",
            (
                SELECT jsonb_build_object('nome', prod.nome)
                FROM public.produtos prod
                WHERE prod.id = r.product_id
            ) AS "product"
        FROM public.reviews r
        LEFT JOIN public.profiles p ON p.id = r.user_id
        LEFT JOIN public.produtos prod ON prod.id = r.product_id
        WHERE (v_rating_val IS NULL OR r.rating = v_rating_val)
          AND (
            v_clean_search = '' OR (
              unaccent(r.comment) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
            )
          )
        ORDER BY r.created_at DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'average_rating', v_average_rating,
        'total_verified', v_total_verified,
        'total_replied', v_total_replied,
        'global_total_count', v_global_total_count,
        'global_average_rating', v_global_average_rating,
        'global_total_verified', v_global_total_verified,
        'global_total_replied', v_global_total_replied
    );
END;
$$;
