-- Rollback manual da 20261300000000. Voltar o FRONT antes.
-- Preserva a coluna nulavel e TODOS os icones gravados; apaga apenas a CHECK.
-- Remover coluna/dados exigiria autorizacao separada e nao faz parte deste rollback.
-- A reaplicacao revalida os dados e recria a mesma CHECK. ACL e policies nunca mudam.
-- Aplicador controla a transacao e o ledger. Pre-voo recusa estrutura desconhecida.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_300$
BEGIN
  IF NOT COALESCE((SELECT count(*) = 1 AND bool_and(atttypid = 'text'::regtype AND atttypmod = -1 AND NOT attnotnull
      AND NOT atthasdef AND attidentity = '' AND attgenerated = '')
    FROM pg_attribute WHERE attrelid = to_regclass('public.categorias') AND attname = 'icone' AND NOT attisdropped), false) OR NOT COALESCE((SELECT count(*) = 1 AND bool_and(contype = 'c' AND convalidated AND
      pg_get_expr(conbin, conrelid) = '(icone = ANY (ARRAY[''todas''::text, ''cuidado''::text, ''brinquedo''::text, ''calcados''::text, ''moda''::text, ''casa''::text, ''tecnologia''::text, ''beleza''::text, ''esporte''::text, ''pet''::text, ''alimento''::text, ''papelaria''::text, ''ferramentas''::text, ''joias''::text]))')
    FROM pg_constraint WHERE conrelid = to_regclass('public.categorias') AND conname = 'categorias_icone_check'), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: coluna ou CHECK nao e a da 20261300000000; nada a desfazer, ou alteracao posterior; revisar antes de reverter.';
  END IF;
END $preflight_rollback_300$;
ALTER TABLE public.categorias DROP CONSTRAINT categorias_icone_check;
