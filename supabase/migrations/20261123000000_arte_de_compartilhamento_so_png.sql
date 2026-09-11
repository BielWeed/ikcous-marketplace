-- Arte de compartilhamento (og) passa a aceitar so image/png. O CHECK antigo
-- tambem aceitava jpeg e webp; o PR #534 do front faz a build gravar o og
-- tambem no caminho fixo og-image.png (servido por extensao, com nosniff) --
-- um og jpeg gravado pela tela antiga derruba a build da loja na proxima
-- release, porque o arquivo fixo deixa de bater com o media_type real.
-- Migration ADITIVA: so troca o corpo de branding_a2_file_valid (CREATE OR
-- REPLACE), a mesma funcao viva desde a 20261121. Nao apaga tabela, coluna
-- nem linha.
-- O preflight recusa ANTES de trocar o corpo se: o corpo vivo divergir do
-- capturado nas duas lojas (A6_ALREADY_PRESENT_OR_DIVERGENT -- cobre tambem
-- a funcao nao existir, porque to_regprocedure de algo ausente da NULL e
-- NULL IS DISTINCT FROM qualquer hash da true, e cobre a migration ja ter
-- sido aplicada antes, porque a 2a execucao acha o hash NOVO em vez do
-- antigo); ou a constraint store_config_branding_assets_a2_check nao
-- existir/nao estar convalidated/divergir do hash capturado na 20261122
-- (A6_BASELINE_DIVERGENT -- prova que o CHECK que usa esta funcao ainda e o
-- mesmo, e nao algo que alguem recriou por fora); ou existir linha viva em
-- store_config com og fora de image/png (A6_OG_NAO_PNG, com a contagem) --
-- o CHECK que usa esta funcao nao revalida linha ja gravada quando o corpo
-- troca, entao a migration prova isso na mao em vez de assumir.
-- O QUE NAO FAZ: nao mexe nas outras roles (header/loader/favicon/
-- apple_touch/icon_192/icon_512/maskable_512 continuam aceitando jpeg/webp/
-- svg/ico como antes) nem em mais nada da A2/A5.
-- ORDEM OBRIGATORIA: aplicar esta migration nas DUAS lojas (principal e
-- Savy) ANTES de publicar o front do PR #534 -- senao uma gravacao pela
-- tela antiga (og jpeg) passa pelo CHECK velho e so quebra quando o front
-- novo tentar servir o caminho fixo.
-- EM BANCO NOVO, a ordem numerica e obrigatoria: 20261121 -> 20261122 ->
-- 20261123. Fora dessa ordem, a 20261122 recusa com A5_BASELINE_DIVERGENT
-- porque fixa o hash ANTIGO (pre-20261123) de branding_a2_file_valid --
-- falha ruidosa, sem dano: so aplique a 20261122 antes desta.
-- Rollback: o corpo anterior de branding_a2_file_valid, restaurado byte a
-- byte no rollback-manual-20261123000000_arte_de_compartilhamento_so_png.sql
-- a partir do texto da 20261121.
-- Sem BEGIN/COMMIT de proposito: o db-apply.cjs aplica cada arquivo numa
-- transacao propria (psql: usar -1).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.store_config IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE v_og_nao_png integer;
BEGIN
  IF (SELECT encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.branding_a2_file_valid(jsonb,text)')),'UTF8')),'hex'))
      IS DISTINCT FROM '3330d1f6030574fe6bdfeb6b8b91e06d562b64737806a84d7d9838214017c172' THEN
    RAISE EXCEPTION 'A6_ALREADY_PRESENT_OR_DIVERGENT: branding_a2_file_valid diverge do corpo vivo capturado nas duas lojas -- ou esta migration ja foi aplicada (og ja so aceita PNG) ou alguem mexeu na funcao por fora; inspecione antes de reaplicar';
  END IF;

  IF (SELECT encode(sha256(convert_to(pg_get_constraintdef(oid),'UTF8')),'hex')
      FROM pg_constraint WHERE conrelid='public.store_config'::regclass
        AND conname='store_config_branding_assets_a2_check' AND convalidated)
      IS DISTINCT FROM '5fd37bd7cd412dd2d01c136adb5ad3e2a3ca0124b7cc7ac9741a3c64d57ba7b0' THEN
    RAISE EXCEPTION 'A6_BASELINE_DIVERGENT: store_config_branding_assets_a2_check';
  END IF;

  SELECT count(*) INTO v_og_nao_png
  FROM public.store_config
  WHERE branding_assets IS NOT NULL
    AND branding_assets->'og'->>'media_type' IS DISTINCT FROM 'image/png';
  IF v_og_nao_png > 0 THEN
    RAISE EXCEPTION 'A6_OG_NAO_PNG: % linha(s) de store_config tem og.media_type fora de image/png; o CHECK novo nao revalida linha existente', v_og_nao_png;
  END IF;
END $preflight$;

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
    WHEN 'og' THEN mime='image/png' AND asset->>'width'='1200' AND asset->>'height'='630'
    ELSE false END,false);
END;
$function$;
