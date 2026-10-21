-- Categoria ganha a FORMA do icone: UM path SVG (o atributo d), escolhido no catalogo do painel.
-- Formato (o mais simples e seguro): UMA string de comandos de path; varios tracos viram subtrechos
-- (M...M...) dentro do mesmo d, sem separador novo. Alfabeto fechado: comandos MmLlHhVvCcSsQqTtAaZz,
-- digitos, espaco, ponto, virgula e hifen; comeca por M/m; no maximo 400 caracteres.
-- Fica de fora tudo que serviria a injecao: < > aspas & ; : ( ) # % + e quebra de linha.
-- NULL = a categoria segue com `icone` (14 chaves) ou com a deducao pelo nome. Sem dependencia entre colunas.
-- ADITIVA: coluna nova nulavel; nenhuma linha existente e reescrita (todas nascem NULL).
-- ACL e RLS ficam INTACTAS: a escrita continua sendo UPDATE direto pelas policies admin da baseline
-- (is_admin do JWT) com o grant de tabela, que cobre a coluna nova; nao ha RPC nem funcao nesta migration.
-- Pre-voo: exige a 20261300000000 (categorias.icone + CHECK das 14 chaves) e a baseline de policies/grants;
-- recusa coluna ou CHECK de mesmo nome com forma desconhecida. Reaplicar e no-op (idempotente).
-- ROLLBACK: rollback-manual-20261351000000_a_categoria_ganha_a_forma_do_icone.sql
-- Primeiro voltar o front. O rollback APAGA a coluna icone_forma (as escolhas do catalogo novo) e a CHECK.
-- Sem controle de transacao: aplicar-migrations.yml/db-apply controla corpo e ledger juntos.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_351$
BEGIN
  IF NOT COALESCE((SELECT count(*) = 1 AND bool_and(relrowsecurity) FROM pg_class WHERE oid = to_regclass('public.categorias')), false) OR NOT COALESCE((SELECT count(*) = 4 AND bool_and(polpermissive AND
    CASE polname
      WHEN 'categorias_select_policy' THEN polcmd = 'r' AND polroles = ARRAY[0::oid]
        AND pg_get_expr(polqual, polrelid) = 'true' AND polwithcheck IS NULL
      WHEN 'categorias_admin_insert_policy' THEN polcmd = 'a' AND polroles = ARRAY['authenticated'::regrole::oid]
        AND polqual IS NULL AND regexp_replace(replace(pg_get_expr(polwithcheck, polrelid), 'public.', ''), '[[:space:]]', '', 'g') = '(SELECTis_admin()ASis_admin)'
      WHEN 'categorias_admin_update_policy' THEN polcmd = 'w' AND polroles = ARRAY['authenticated'::regrole::oid]
        AND regexp_replace(replace(pg_get_expr(polqual, polrelid), 'public.', ''), '[[:space:]]', '', 'g') = '(SELECTis_admin()ASis_admin)'
        AND regexp_replace(replace(pg_get_expr(polwithcheck, polrelid), 'public.', ''), '[[:space:]]', '', 'g') = '(SELECTis_admin()ASis_admin)'
      WHEN 'categorias_admin_delete_policy' THEN polcmd = 'd' AND polroles = ARRAY['authenticated'::regrole::oid]
        AND regexp_replace(replace(pg_get_expr(polqual, polrelid), 'public.', ''), '[[:space:]]', '', 'g') = '(SELECTis_admin()ASis_admin)'
        AND polwithcheck IS NULL
      ELSE false
    END)
    FROM pg_policy WHERE polrelid = to_regclass('public.categorias')), false)
     OR NOT COALESCE((SELECT has_table_privilege('anon', 'public.categorias', 'SELECT')
    AND has_table_privilege('authenticated', 'public.categorias', 'SELECT')
    AND has_table_privilege('authenticated', 'public.categorias', 'UPDATE')), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: categorias precisa das quatro policies de leitura publica/escrita admin e dos grants existentes; nada foi alterado.';
  END IF;
  IF NOT COALESCE((SELECT count(*) = 1 AND bool_and(atttypid = 'text'::regtype AND atttypmod = -1 AND NOT attnotnull
      AND NOT atthasdef AND attidentity = '' AND attgenerated = '')
    FROM pg_attribute WHERE attrelid = to_regclass('public.categorias') AND attname = 'icone' AND NOT attisdropped), false)
     OR NOT COALESCE((SELECT count(*) = 1 AND bool_and(contype = 'c' AND convalidated AND
      pg_get_expr(conbin, conrelid) = '(icone = ANY (ARRAY[''todas''::text, ''cuidado''::text, ''brinquedo''::text, ''calcados''::text, ''moda''::text, ''casa''::text, ''tecnologia''::text, ''beleza''::text, ''esporte''::text, ''pet''::text, ''alimento''::text, ''papelaria''::text, ''ferramentas''::text, ''joias''::text]))')
    FROM pg_constraint WHERE conrelid = to_regclass('public.categorias') AND conname = 'categorias_icone_check'), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: categorias.icone e categorias_icone_check (20261300000000) precisam existir como na base conhecida; nada foi alterado.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.categorias') AND attname = 'icone_forma' AND NOT attisdropped)
     AND NOT COALESCE((SELECT count(*) = 1 AND bool_and(atttypid = 'text'::regtype AND atttypmod = -1 AND NOT attnotnull
      AND NOT atthasdef AND attidentity = '' AND attgenerated = '')
    FROM pg_attribute WHERE attrelid = to_regclass('public.categorias') AND attname = 'icone_forma' AND NOT attisdropped), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: categorias.icone_forma existente nao e text nulavel sem default.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.categorias') AND conname = 'categorias_icone_forma_check')
     AND NOT COALESCE((SELECT count(*) = 1 AND bool_and(contype = 'c' AND convalidated AND
      pg_get_expr(conbin, conrelid) = '((icone_forma IS NULL) OR ((char_length(icone_forma) <= 400) AND (icone_forma ~ ''^[Mm][MmLlHhVvCcSsQqTtAaZz0-9 .,-]*$''::text)))')
    FROM pg_constraint WHERE conrelid = to_regclass('public.categorias') AND conname = 'categorias_icone_forma_check'), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: categorias_icone_forma_check desconhecida.';
  END IF;
END $preflight_351$;

ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS icone_forma text;
DO $check_351$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.categorias'::regclass AND conname = 'categorias_icone_forma_check') THEN
    ALTER TABLE public.categorias ADD CONSTRAINT categorias_icone_forma_check
      CHECK (icone_forma IS NULL OR (char_length(icone_forma) <= 400 AND icone_forma ~ '^[Mm][MmLlHhVvCcSsQqTtAaZz0-9 .,-]*$'));
  END IF;
END $check_351$;

NOTIFY pgrst, 'reload schema';
