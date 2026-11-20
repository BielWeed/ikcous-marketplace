-- 46m — MEDICAO, so leitura: produtos ativos no formato antigo de variacoes independentes.
-- Uma loja por run. Rol aberto (tipo | objeto | detalhe), sem coluna ok.
-- Espelha mapVariantFromDB e chaveDoGrupo: nome vazio vira "Padrão".
-- O trim usa os espacos do ECMAScript, e o lower usa ICU neutro, nao a locale do banco.
-- Depois do trim, uma chave vazia nao conta como grupo.
-- Conta grupos tambem nas variacoes desligadas, como no aviso do formulario.
-- A amostra mostra so IDs, sem nomes de produtos nem estoque no log publico.
WITH ativos AS (
  SELECT p.id
    FROM public.produtos p
   WHERE p.ativo IS TRUE AND p.deleted_at IS NULL
), variacoes AS (
  SELECT v.product_id,
         NULLIF(lower(btrim(COALESCE(NULLIF(v.name, ''), 'Padrão'),
                            U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
                      COLLATE pg_catalog."und-x-icu") COLLATE pg_catalog."C", '') AS chave
    FROM public.product_variants v
    JOIN ativos a ON a.id = v.product_id
), afetados AS (
  SELECT product_id
    FROM variacoes
   GROUP BY product_id
  HAVING count(DISTINCT chave) > 1
), amostra AS (
  SELECT product_id AS id
    FROM afetados
   ORDER BY id
   LIMIT 20
), r AS (
  SELECT 0 AS ordem, 'total' AS tipo, 'produtos' AS objeto,
         'ativos=' || (SELECT count(*) FROM ativos)::text
         || '|com_variacoes_independentes=' || (SELECT count(*) FROM afetados)::text
         || '|rls_produtos=' || row_security_active('public.produtos'::regclass)::int
         || '|rls_variacoes=' || row_security_active('public.product_variants'::regclass)::int AS detalhe
  UNION ALL
  SELECT 1, 'produto', id::text, 'variacoes_independentes'
    FROM amostra
)
SELECT tipo, objeto, detalhe
  FROM r
 ORDER BY ordem, objeto;
