-- 114b-antes-o-texto-da-avaliacao-tem-teto-no-banco-ausente: ANTES da 20261396200000 (ou depois do rollback-manual dela). SO LEITURA, somente catalogo,
-- rol fechado de 3 linhas. Nao le nenhuma avaliacao. Antes do apply tudo "sim"; depois do apply a linha do CHECK fica "nao" de proposito.
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'reviews: comment e text e o CHECK reviews_comment_ate_1000_caracteres ainda NAO existe', 'sim', CASE WHEN
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.reviews') AND attname = 'comment' AND atttypid = 'text'::regtype AND NOT attisdropped)
    AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = 'reviews_comment_ate_1000_caracteres') THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'reviews: nenhum outro CHECK limita a coluna comment hoje (o teto da tela, 1000, ainda nao esta no banco)', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.reviews') AND c.contype = 'c'
        AND position('comment' IN pg_get_constraintdef(c.oid)) > 0) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
