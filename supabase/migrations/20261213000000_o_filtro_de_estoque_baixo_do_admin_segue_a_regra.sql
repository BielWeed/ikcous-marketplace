-- ============================================================================
-- Migration 20261213000000 — o filtro de estoque baixo do admin segue a regra
-- (painel simples, onda I, item I1; 09/10/2026)
-- ============================================================================
--
-- 1. O DEFEITO QUE ESTA MIGRATION FECHA
--
-- `get_admin_products_paged(..., p_stock => 'low', ...)` filtrava por
-- `p.estoque <= 5` fixo, sobre a coluna crua (baseline:1736 e 1764): ignorava
-- o `estoque_minimo` que o lojista escolhe e, em produto com variações, a soma
-- delas. A função nunca foi redefinida depois da baseline. Hoje o ramo é
-- morto (ninguém passa 'low'; o PDV passa 'all'), mas é a PORTA do filtro
-- "estoque baixo" da tela de Produtos — se alguém a ligar, tem de contar os
-- mesmos produtos que o Início, o analytics e o front.
--
-- 2. A REGRA (ÚNICA, a mesma em todo o painel)
--
-- Estoque efetivo (soma de `stock_increment` das variações ATIVAS se houver
-- alguma; senão `produtos.estoque`) <= COALESCE(estoque_minimo, 5) — a régua
-- de `get_admin_analytics_v2`, de `painel_inicio` (20261212000000) e de
-- `precisaDeReposicao` (src/utils/avisos-do-lojista.ts). Trocam SÓ as duas
-- linhas do filtro (contagem e página); o resto do corpo é o da baseline byte
-- a byte, inclusive o espaço no fim de `SELECT ` (o md5 pega). Nenhuma guarda
-- nova: é catálogo, e a 20261199000000 a deixou de fora de propósito
-- (20261199000000:57). Mesmos parâmetros, defaults, SECURITY DEFINER e
-- search_path; `CREATE OR REPLACE` preserva dono e ACL — nenhum GRANT/REVOKE,
-- e `database.types.ts` não muda. `p_stock = 'all'` e a busca não mudam.
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha é lida para decidir nem reescrita ao aplicar — só o corpo de
-- uma função muda.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se o corpo vivo, por `md5(replace(prosrc, E'\r', ''))`, não for o da
-- baseline nem o que esta migration deixa. Os hashes são o md5 REAL dos
-- corpos, amarrados ao texto por
-- tests/migration_o_filtro_de_estoque_baixo_do_admin_segue_a_regra_test.ts.
--
-- 5. IDEMPOTÊNCIA
--
-- O pré-voo aceita o corpo desta migration; reaplicar deixa o mesmo estado.
--
-- 6. TRANSAÇÃO
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa, AGENTS.md). O arquivo
-- vai numa consulta só pelo `aplicar-migrations.yml`; local, `psql -1`.
--
-- 7. ORDEM E ROLLBACK
--
-- Independe da 20261212000000 e da 20261214000000 (funções diferentes) e da
-- 20261199000000 (que não toca esta função). ROLLBACK MANUAL:
-- rollback-manual-20261213000000_o_filtro_de_estoque_baixo_do_admin_segue_a_regra.sql
-- devolve o corpo da baseline byte a byte.
--
-- 8. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid =
--        to_regprocedure('public.get_admin_products_paged(text,text,text,text,integer,integer)');
--      -- esperado: d3a111d95dabb52efe7af6f3ce66fb7e.
--   2. Como admin: `get_admin_products_paged('', 'all', 'active', 'low', 0,
--      100)->>'total_count'` igual a `get_admin_analytics_v2(90)->>
--      'inventoryAlerts'`.
--   3. `proacl`, `prosecdef` e `proconfig` iguais antes e depois.
--   PROVA VIVA: tests/banco/estoque-baixo-uma-regra-viva.cjs (rpc-ci).
-- ============================================================================

DO $preflight_20261213$
DECLARE
  r record;
  v_hash text;
BEGIN
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.get_admin_products_paged(text,text,text,text,integer,integer)', '1d5a5544dd55c78ba4dc729755916754', 'd3a111d95dabb52efe7af6f3ce66fb7e')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente antes desta migration nem o que ela deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;
END $preflight_20261213$;

-- get_admin_products_paged: corpo vigente da 20260806000000_baseline_do_schema_vivo.sql,
-- com os dois filtros de estoque baixo trocados pela regra da loja.
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
      AND (p_stock = 'all' OR (p_stock = 'low' AND (CASE WHEN EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) THEN (SELECT COALESCE(sum(COALESCE(pv.stock_increment, 0)), 0) FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) ELSE p.estoque END) <= COALESCE(p.estoque_minimo, 5)))
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
          AND (p_stock = 'all' OR (p_stock = 'low' AND (CASE WHEN EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) THEN (SELECT COALESCE(sum(COALESCE(pv.stock_increment, 0)), 0) FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) ELSE p.estoque END) <= COALESCE(p.estoque_minimo, 5)))
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
