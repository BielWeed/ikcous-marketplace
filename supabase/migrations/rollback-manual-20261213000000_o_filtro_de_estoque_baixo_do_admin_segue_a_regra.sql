-- ============================================================================
-- Rollback manual — o filtro de estoque baixo do admin segue a regra (20261213000000)
-- ============================================================================
-- Devolve, byte a byte, o corpo de `public.get_admin_products_paged(text,
-- text, text, text, integer, integer)` da baseline (md5
-- 1d5a5544dd55c78ba4dc729755916754): o filtro `p_stock = 'low'` volta a ser
-- `p.estoque <= 5` fixo sobre a coluna crua. Mesmos parâmetros e defaults,
-- mesmo SECURITY DEFINER, mesmo search_path, mesma ACL (CREATE OR REPLACE
-- preserva a vigente); nada é apagado.
--
-- ORDEM: independe dos rollbacks da 20261212000000 e da 20261214000000 e do
-- da 20261199000000 (nenhum toca esta função).
--
-- DADOS: a migration não gravou nada em linha nenhuma; não há dado a desfazer.
--
-- PRÉ-VOO: o `DO $preflight_rollback_20261213$` recusa com
-- `B1_BASELINE_DIVERGENT` — ANTES de qualquer escrita — se o corpo VIVO (md5
-- de `replace(prosrc, E'\r', '')`) não for exatamente o que a 20261213000000
-- deixou: desfazer por cima de uma redefinição POSTERIOR apagaria a dela em
-- silêncio, e desfazer duas vezes não tem o que desfazer.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply, que registraria este
-- rollback no ledger como migration nova). Sem BEGIN/COMMIT de nível superior
-- neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261213$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.get_admin_products_paged(text,text,text,text,integer,integer)', 'd3a111d95dabb52efe7af6f3ce66fb7e')
      ) AS esperado(assinatura, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o que a 20261213000000 deixou — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
END $preflight_rollback_20261213$;

-- get_admin_products_paged: corpo vigente da 20260806000000_baseline_do_schema_vivo.sql.
CREATE OR REPLACE FUNCTION public.get_admin_products_paged(p_search text DEFAULT ''::text, p_category text DEFAULT 'all'::text, p_status text DEFAULT 'all'::text, p_stock text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

    -- Compute total count with filters (before pagination)
    SELECT COUNT(p.id) INTO v_total_count
    FROM public.produtos p
    WHERE p.deleted_at IS NULL
      AND (p_category = 'all' OR p.categoria = p_category)
      AND (p_status = 'all' OR (p_status = 'active' AND p.ativo = TRUE) OR (p_status = 'inactive' AND p.ativo = FALSE))
      AND (p_stock = 'all' OR (p_stock = 'low' AND p.estoque <= 5))
      AND (
        v_clean_search = '' OR (
          unaccent(p.nome) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(p.codigo) ILIKE unaccent('%' || v_clean_search || '%')
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
          AND (p_stock = 'all' OR (p_stock = 'low' AND p.estoque <= 5))
          AND (
            v_clean_search = '' OR (
              unaccent(p.nome) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(p.codigo) ILIKE unaccent('%' || v_clean_search || '%')
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
$$;
