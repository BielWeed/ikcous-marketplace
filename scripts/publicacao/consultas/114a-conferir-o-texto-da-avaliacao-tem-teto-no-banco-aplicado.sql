-- 114a-conferir-o-texto-da-avaliacao-tem-teto-no-banco-aplicado: DEPOIS da 20261396200000 (o CHECK reviews_comment_ate_1000_caracteres em public.reviews).
-- SO LEITURA, somente catalogo, rol fechado de 3 linhas. Nao le nenhuma avaliacao. Antes do apply responde "nao" na linha do CHECK (a 114a negativa
-- e' esperada), nunca erro. A linha do CHECK aceita NOT VALID ou ja validado. A contagem de avaliacoes antigas acima de 1000 NAO mora aqui (esta
-- consulta nao le dado): ela esta no cabecalho da migration, para rodar a mao em cada loja ANTES do apply.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'reviews: CHECK reviews_comment_ate_1000_caracteres (char_length(comment) <= 1000) existe', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.reviews') AND c.conname = 'reviews_comment_ate_1000_caracteres' AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) IN ('CHECK ((char_length(comment) <= 1000)) NOT VALID', 'CHECK ((char_length(comment) <= 1000))')) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'reviews: so existe UM CHECK sobre a coluna comment (nenhum outro teto concorrente)', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = to_regclass('public.reviews') AND c.contype = 'c'
        AND position('comment' IN pg_get_constraintdef(c.oid)) > 0) = 1 THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
