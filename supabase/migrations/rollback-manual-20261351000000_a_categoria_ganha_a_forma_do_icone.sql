-- Rollback manual da 20261351000000. Voltar o FRONT antes (o front antigo ignora a coluna; o novo a espera).
-- Remove SO o que a migration criou: a CHECK categorias_icone_forma_check e a coluna icone_forma.
-- ATENCAO: apagar a coluna descarta as formas de icone que a lojista escolheu no catalogo novo
-- (as categorias voltam ao `icone` das 14 chaves ou a deducao pelo nome). Nao toca categorias.icone,
-- categorias_icone_check, ACL, policies nem nenhuma outra linha.
-- A reaplicacao recria coluna e CHECK vazias. Aplicador controla a transacao e o ledger.
-- Pre-voo recusa estrutura desconhecida (nada a desfazer, ou alteracao posterior).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_351$
BEGIN
  IF NOT COALESCE((SELECT count(*) = 1 AND bool_and(atttypid = 'text'::regtype AND atttypmod = -1 AND NOT attnotnull
      AND NOT atthasdef AND attidentity = '' AND attgenerated = '')
    FROM pg_attribute WHERE attrelid = to_regclass('public.categorias') AND attname = 'icone_forma' AND NOT attisdropped), false) OR NOT COALESCE((SELECT count(*) = 1 AND bool_and(contype = 'c' AND convalidated AND
      pg_get_expr(conbin, conrelid) = '((icone_forma IS NULL) OR ((char_length(icone_forma) <= 400) AND (icone_forma ~ ''^[Mm][MmLlHhVvCcSsQqTtAaZz0-9 .,-]*$''::text)))')
    FROM pg_constraint WHERE conrelid = to_regclass('public.categorias') AND conname = 'categorias_icone_forma_check'), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: coluna ou CHECK nao e a da 20261351000000; nada a desfazer, ou alteracao posterior; revisar antes de reverter.';
  END IF;
END $preflight_rollback_351$;
ALTER TABLE public.categorias DROP CONSTRAINT categorias_icone_forma_check;
ALTER TABLE public.categorias DROP COLUMN icone_forma;
NOTIFY pgrst, 'reload schema';
