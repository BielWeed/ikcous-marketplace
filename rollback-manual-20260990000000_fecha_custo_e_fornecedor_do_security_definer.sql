-- ROLLBACK MANUAL de 20260990000000_fecha_custo_e_fornecedor_do_security_definer.sql
--
-- Sem dado gravado por esta migration (so muda corpo de funcao e grant) — a
-- reversao e so SCHEMA, sem retrato de dados para restaurar. Ordem: devolve
-- os dois corpos/grants exatamente como estavam em
-- supabase/migrations/20260806000000_baseline_do_schema_vivo.sql (linhas
-- 892 e 2466-2500), antes desta migration.
--
-- ATENCAO: aplicar este rollback volta a expor `custo` e `fornecedor_id` de
-- TODOS os produtos para `anon` via `get_product_recommendations`, e volta a
-- deixar `get_active_products_internal` executavel por `anon`/`authenticated`
-- — exatamente o defeito que a migration fechou. So aplicar para reverter um
-- problema causado pela migration em si.

-- ALCANCE (formato combinado com o GLM em 25/08/2026, para quem le em incidente):
--   RESTAURA ....... definicao das duas funcoes (corpo, SECURITY DEFINER,
--                    search_path) e os grants que o CREATE OR REPLACE preserva.
--   NAO RESTAURA ... Sem DML. Sem view. Sem sequence. Esta migration nao grava,
--                    apaga nem altera linha nenhuma, entao nao ha dado a repor.
--   A omissao seria pior que a linha: "nao diz nada sobre DML" e indistinguivel
--   de "ninguem pensou em DML" na cabeca de quem abre isto durante um problema.

-- 1. get_product_recommendations volta a fazer SELECT * (verbatim da
--    definicao viva em 20260612000000_security_definer_and_otp_fix.sql /
--    baseline). CREATE OR REPLACE preserva o GRANT EXECUTE que ja existe
--    para anon/authenticated/service_role — nao precisa re-GRANT aqui.
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
    SELECT *
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
    LIMIT p_limit;
END;
$function$;

-- 2. get_active_products_internal: devolve o EXECUTE a anon/authenticated
--    (mesmos tres papeis do GRANT original em 20260323000001_fix_produtos_custo_leak.sql).
--    O corpo da funcao nunca foi tocado por esta migration, entao nao ha
--    o que recriar aqui — so o privilegio.
GRANT EXECUTE ON FUNCTION public.get_active_products_internal() TO anon, authenticated, service_role;
