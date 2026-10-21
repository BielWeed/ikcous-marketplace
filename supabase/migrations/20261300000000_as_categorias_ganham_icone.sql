-- Categoria ganha chave opcional de icone; NULL = deducao pelo nome no app.
-- ADITIVA: nenhuma linha existente e reescrita. ACL e RLS ficam INTACTAS.
-- Mantem as policies da baseline (is_admin do JWT); nao troca o modelo de autorizacao.
-- Pre-voo aceita somente a base conhecida ou a propria migration (reaplicacao).
-- ROLLBACK: rollback-manual-20261300000000_as_categorias_ganham_icone.sql
-- Primeiro voltar o front. Rollback remove so a CHECK, preservando a coluna e escolhas.
-- Sem controle de transacao: aplicar-migrations.yml/db-apply controla corpo e ledger juntos.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_300$
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
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.categorias') AND attname = 'icone' AND NOT attisdropped)
     AND NOT COALESCE((SELECT count(*) = 1 AND bool_and(atttypid = 'text'::regtype AND atttypmod = -1 AND NOT attnotnull
      AND NOT atthasdef AND attidentity = '' AND attgenerated = '')
    FROM pg_attribute WHERE attrelid = to_regclass('public.categorias') AND attname = 'icone' AND NOT attisdropped), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: categorias.icone existente nao e text nulavel sem default.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.categorias') AND conname = 'categorias_icone_check')
     AND NOT COALESCE((SELECT count(*) = 1 AND bool_and(contype = 'c' AND convalidated AND
      pg_get_expr(conbin, conrelid) = '(icone = ANY (ARRAY[''todas''::text, ''cuidado''::text, ''brinquedo''::text, ''calcados''::text, ''moda''::text, ''casa''::text, ''tecnologia''::text, ''beleza''::text, ''esporte''::text, ''pet''::text, ''alimento''::text, ''papelaria''::text, ''ferramentas''::text, ''joias''::text]))')
    FROM pg_constraint WHERE conrelid = to_regclass('public.categorias') AND conname = 'categorias_icone_check'), false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: categorias_icone_check desconhecida.';
  END IF;
END $preflight_300$;

ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS icone text;
DO $check_300$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.categorias'::regclass AND conname = 'categorias_icone_check') THEN
    ALTER TABLE public.categorias ADD CONSTRAINT categorias_icone_check
      CHECK (icone IN ('todas', 'cuidado', 'brinquedo', 'calcados', 'moda', 'casa', 'tecnologia', 'beleza', 'esporte', 'pet', 'alimento', 'papelaria', 'ferramentas', 'joias'));
  END IF;
END $check_300$;

NOTIFY pgrst, 'reload schema';
