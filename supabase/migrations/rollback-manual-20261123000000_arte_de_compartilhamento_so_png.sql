-- ============================================================================
-- Rollback manual — arte de compartilhamento so aceita PNG (20261123000000)
-- ============================================================================
-- Restaura o corpo de branding_a2_file_valid para exatamente o que a 20261121
-- criou (bytes copiados dali, sem retocar espaco, quebra de linha nem
-- comentario) -- volta a aceitar image/jpeg e image/webp para a role 'og'.
-- Reverter isto SEM reverter tambem o front do PR #534 (que passou a gravar
-- e servir og-image.png por extensao) reabre a janela que a migration
-- fechou: uma gravacao pela tela antiga volta a poder salvar og jpeg.
-- Executar sob transacao externa (db-apply ou psql -1). Sem BEGIN/COMMIT de
-- proposito: o aplicador abre a transacao.
-- O QUE PRESERVA: todas as linhas de store_config e todos os demais objetos
-- da A2/A5 -- so o corpo desta funcao muda.
-- Idempotente: CREATE OR REPLACE FUNCTION nao falha se o corpo ja for este.
-- ============================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.store_config IN ACCESS EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.branding_a2_file_valid(asset jsonb, asset_role text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
DECLARE mime text; pathname text; dimension text;
BEGIN
  IF jsonb_typeof(asset) IS DISTINCT FROM 'object'
    OR NOT asset ?& ARRAY['path','sha256','media_type','bytes']
    OR asset - ARRAY['path','sha256','media_type','bytes','width','height'] <> '{}'::jsonb THEN RETURN false; END IF;
  IF jsonb_typeof(asset->'path') IS DISTINCT FROM 'string'
    OR jsonb_typeof(asset->'sha256') IS DISTINCT FROM 'string'
    OR jsonb_typeof(asset->'media_type') IS DISTINCT FROM 'string'
    OR jsonb_typeof(asset->'bytes') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  pathname := asset->>'path'; mime := asset->>'media_type';
  IF pathname !~ '^v1/[a-f0-9]{64}/[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
    OR asset->>'sha256' !~ '^[a-f0-9]{64}$'
    OR split_part(pathname,'/',2) <> asset->>'sha256'
    OR asset->>'bytes' !~ '^[0-9]+$' THEN RETURN false; END IF;
  IF (asset->>'bytes')::numeric NOT BETWEEN 1 AND 20971520 THEN RETURN false; END IF;
  IF NOT (CASE mime
    WHEN 'image/png' THEN lower(pathname) ~ '\.png$'
    WHEN 'image/jpeg' THEN lower(pathname) ~ '\.jpe?g$'
    WHEN 'image/webp' THEN lower(pathname) ~ '\.webp$'
    WHEN 'image/svg+xml' THEN lower(pathname) ~ '\.svg$'
    WHEN 'image/vnd.microsoft.icon' THEN lower(pathname) ~ '\.ico$'
    ELSE false END) THEN RETURN false; END IF;
  IF (asset ? 'width') <> (asset ? 'height') THEN RETURN false; END IF;
  IF asset ? 'width' THEN
    FOREACH dimension IN ARRAY ARRAY['width','height'] LOOP
      IF jsonb_typeof(asset->dimension) IS DISTINCT FROM 'number'
        OR asset->>dimension !~ '^[0-9]+$' THEN RETURN false; END IF;
      IF (asset->>dimension)::numeric NOT BETWEEN 1 AND 8192 THEN RETURN false; END IF;
    END LOOP;
  END IF;
  RETURN COALESCE(CASE asset_role
    WHEN 'original' THEN true
    WHEN 'header' THEN mime IN ('image/png','image/jpeg','image/webp','image/svg+xml')
    WHEN 'loader' THEN mime IN ('image/png','image/jpeg','image/webp','image/svg+xml')
    WHEN 'favicon' THEN mime IN ('image/png','image/svg+xml','image/vnd.microsoft.icon')
    WHEN 'apple_touch' THEN mime='image/png' AND asset->>'width'='180' AND asset->>'height'='180'
    WHEN 'icon_192' THEN mime='image/png' AND asset->>'width'='192' AND asset->>'height'='192'
    WHEN 'icon_512' THEN mime='image/png' AND asset->>'width'='512' AND asset->>'height'='512'
    WHEN 'maskable_512' THEN mime='image/png' AND asset->>'width'='512' AND asset->>'height'='512'
    WHEN 'og' THEN mime IN ('image/png','image/jpeg','image/webp') AND asset->>'width'='1200' AND asset->>'height'='630'
    ELSE false END,false);
END;
$function$;
