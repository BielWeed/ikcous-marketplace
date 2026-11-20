-- 46m — MEDICAO, so leitura: produtos ativos no formato antigo de variacoes independentes.
-- Uma loja por run. Rol aberto (tipo | objeto | detalhe), sem coluna ok.
-- Espelha mapVariantFromDB e chaveDoGrupo: nome vazio vira "Padrão".
-- O trim usa os espacos do ECMAScript, e o lower usa ICU neutro, nao a locale do banco.
-- Depois do trim, uma chave vazia nao conta como grupo.
-- Conta grupos tambem nas variacoes desligadas, como no aviso do formulario.
-- O estoque soma so variacoes ativas (active nulo vale true no painel).
WITH ativos AS (
  SELECT p.id, p.nome
    FROM public.produtos p
   WHERE p.ativo IS TRUE AND p.deleted_at IS NULL
), variacoes AS (
  SELECT v.product_id,
         NULLIF(lower(btrim(COALESCE(NULLIF(v.name, ''), 'Padrão'),
                            U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
                      COLLATE pg_catalog."und-x-icu") COLLATE pg_catalog."C", '') AS chave,
         CASE WHEN v.active IS NOT FALSE THEN COALESCE(v.stock_increment, 0)
              ELSE 0 END AS estoque
    FROM public.product_variants v
    JOIN ativos a ON a.id = v.product_id
), afetados AS (
  SELECT product_id, sum(estoque) AS soma_estoque
    FROM variacoes
   GROUP BY product_id
  HAVING count(DISTINCT chave) > 1
), amostra AS (
  SELECT a.id, a.nome, f.soma_estoque
    FROM afetados f
    JOIN ativos a ON a.id = f.product_id
   ORDER BY a.id
   LIMIT 20
), r AS (
  SELECT 0 AS ordem, 'total' AS tipo, 'produtos' AS objeto,
         'ativos=' || (SELECT count(*) FROM ativos)::text
         || '|com_variacoes_independentes=' || (SELECT count(*) FROM afetados)::text
         || '|rls_produtos=' || row_security_active('public.produtos'::regclass)::int
         || '|rls_variacoes=' || row_security_active('public.product_variants'::regclass)::int AS detalhe
  UNION ALL
  SELECT 1, 'produto', id::text,
         'nome=' || to_json(nome)::text || '|soma_estoque=' || soma_estoque::text
    FROM amostra
)
SELECT tipo, objeto, detalhe
  FROM r
 ORDER BY ordem, objeto;
