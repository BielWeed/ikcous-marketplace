-- Fecha o vazamento de custo/fornecedor pelas duas RPCs SECURITY DEFINER de
-- produto. Medido em 25/08/2026: `get_product_recommendations` e
-- `get_active_products_internal` sao `SECURITY DEFINER`, devolvem
-- `SETOF public.produtos` e fazem `SELECT *` — a linha inteira, com `custo`
-- e `fornecedor_id` junto — para `anon` (qualquer visitante sem login).
-- Medicao ao vivo pelo endpoint publico: 19 linhas com `custo` preenchido
-- (maior 62.08) nas recomendacoes da pagina de produto.
--
-- POR QUE A FORMA E DIFERENTE PARA CADA UMA (as duas nao sao o mesmo caso):
--   - `get_product_recommendations` E CHAMADA pelo app (useProducts.ts:1174,
--     alcancada de ProductView.tsx:502) — a vitrine depende do retorno dela.
--     Revogar quebraria a pagina de produto. A correcao aqui e ESTREITAR O
--     RETORNO: o corpo passa a devolver a linha com `custo` e
--     `fornecedor_id` NULOS, mantendo `RETURNS SETOF public.produtos`
--     intacto — nenhum chamador (front, PostgREST, tipos gerados) enxerga
--     mudanca de contrato. Verificado antes de escrever: mapProductFromDB
--     (src/lib/mappers.ts) trata `custo` como opcional (`row.custo ?? row.cost_price`,
--     vira `undefined` se ausente/nulo) e nunca le `fornecedor_id` — a tela
--     de produto continua servida por inteiro.
--   - `get_active_products_internal` NAO e chamada em lugar nenhum do
--     repositorio (varredura em src/, supabase/functions/, scripts/,
--     10-min antes desta migration: so aparece em tipos gerados, doc e nas
--     proprias migrations que a criaram). E a gemea dormente — a correcao
--     minima e REVOGAR o EXECUTE de quem nao devia ter, em vez de reescrever
--     um corpo que ninguem usa.
--
-- `CREATE OR REPLACE FUNCTION` em vez de `DROP` + `CREATE`: o `DROP`
-- apaga a funcao e perde os `GRANT EXECUTE` que ja existem (licao registrada
-- em ~/.claude/mural/core_app_mkt/_REGRAS.md, por volta da linha 448 —
-- "CREATE OR REPLACE preserva permissao e dono porque nao apaga a funcao").
-- A assinatura (`p_product_id uuid, p_limit integer DEFAULT 4`) e repetida
-- IDENTICA a atual para nao criar uma segunda sobrecarga silenciosa (a
-- "assinatura da bomba": 1 parametro com DEFAULT num par e o padrao que ja
-- quebrou `get_retention_analytics` neste banco).
--
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK da prova vira no-op
-- e a mudanca fica gravada mesmo assim).
-- Faixa 20260990* a 20260999*, reservada no _REGRAS.md ANTES de existir.
-- NAO aplicar sem prova de ROLLBACK e sem o Gabriel autorizar NESTA sessao.
--
-- FICHA DE VERIFICACAO pos-aplicacao (rodar contra o banco; nao rodada por
-- este agente — sem acesso a DATABASE_URL neste ambiente):
--
--   -- 1. get_product_recommendations nao devolve mais custo/fornecedor.
--   --    Asserção única: exige PRESENÇA (existe linha) E AUSÊNCIA (nenhuma
--   --    tem custo/fornecedor) ao mesmo tempo — "count(custo) = 0" sozinho
--   --    passa trivialmente com zero linhas, o que não prova nada.
--   SELECT count(*) > 0 AND count(custo) = 0 AND count(fornecedor_id) = 0 AS ok
--     FROM get_product_recommendations(
--       (SELECT id FROM produtos WHERE ativo = true LIMIT 1), 4
--     );
--     -> espera true (se der false por count(*) = 0, o cenário de teste não
--        tem produto elegível — repita com outro produto antes de concluir
--        que a correção falhou)
--
--   -- 2. get_active_products_internal deixou de ser alcancavel por quem
--   --    nao devia:
--   SELECT has_function_privilege('anon', 'public.get_active_products_internal()', 'EXECUTE') AS anon_ainda_executa,
--          has_function_privilege('authenticated', 'public.get_active_products_internal()', 'EXECUTE') AS authenticated_ainda_executa;
--     -> espera false, false
--
--   -- 3. controle negativo: a vitrine continua de pe (mesma consulta que
--   --    a pagina de produto realmente faz):
--   SELECT count(*) FROM get_product_recommendations(
--     (SELECT id FROM produtos WHERE ativo = true LIMIT 1), 4
--   );
--     -> espera > 0 quando existir produto da mesma categoria/tag ativo com
--        estoque — a funcao continua recomendando, so para de vazar custo.
--
-- MENTIRA DE TIPO, SEM CONSEQUENCIA HOJE (registrada, nao corrigida — os
-- arquivos abaixo sao GERADOS e estao fora do escopo desta migration):
-- `src/types/database.types.ts` e `src/lib/supabase.ts` declaram `custo`
-- como coluna NAO-NULA na `Row` de `produtos`, que e o `Returns` desta RPC.
-- A partir desta migration o runtime devolve `null` em `custo` (e em
-- `fornecedor_id`) para quem chama `get_product_recommendations` — o tipo
-- gerado nao reflete isso. Nenhum consumidor atual le esse campo aqui
-- (ver mapProductFromDB acima), entao nao ha efeito hoje. Quem confiar no
-- tipo gerado para ESTA RPC especificamente vai ler `custo` como garantido
-- e levar undefined behavior em runtime — regenerar os tipos, ou anotar a
-- excecao, fica para quem tocar nisso a seguir.

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
        p.comprimento_cm
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

-- get_active_products_internal: gemea dormente, ninguem no repositorio a
-- chama. Nao mexe no corpo (SELECT * continua ali, mas so alcancavel por
-- quem ja bypassa RLS de qualquer forma) — so tira o EXECUTE de quem nunca
-- deveria ter tido: mesma fronteira que a tabela produtos ja aplica direto
-- (REVOKE SELECT ... FROM anon, authenticated; migration 20260323000001).
-- service_role fica de fora do REVOKE porque ja bypassa RLS por natureza no
-- Postgres/Supabase — revogar dela nao muda seguranca nenhuma, so quebraria
-- uso interno hipotetico do lado do servidor.
REVOKE EXECUTE ON FUNCTION public.get_active_products_internal() FROM anon, authenticated;
