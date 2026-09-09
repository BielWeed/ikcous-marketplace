-- Cada ocorrencia da identidade recebe um numero privado, inclusive por escritores antigos.
-- Linhas existentes conservam todos os valores e comecam na revisao zero, sem UPDATE.
-- Reaplicacao recusa sem alterar estado; retorno operacional conserva a protecao.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.store_config IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE dependency record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.store_config'::regclass
      AND attname='identity_revision' AND NOT attisdropped)
    OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('branding_a5_revision_seq','branding_a5_track_revision','read_store_identity','save_store_identity'))
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('branding_a5_revision_seq','branding_a5_track_revision','read_store_identity','save_store_identity'))
    OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.store_config'::regclass
      AND conname='store_config_identity_revision_a5_check') THEN
    RAISE EXCEPTION 'A5_ALREADY_PRESENT_OR_DIVERGENT: inspect existing objects before applying';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.store_config'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'A5_BASELINE_DIVERGENT: unreviewed store_config trigger';
  END IF;
  -- pg_get_functiondef hashes measured on the reproduced A2 fixture, both variants.
  -- Includes body, signature, security mode, volatility and per-function settings.
  FOR dependency IN SELECT * FROM (VALUES
    ('public.upsert_store_config(jsonb)','9205e85e68d24f3937037973f9de0e065fa79d9613e52cd253f1cacceee0f818'),
    ('public.is_admin()','a840ba90af1ff9dd1fac3531e25b6005d6a9da174933d96ca873e0b3a600edc6'),
    ('public.branding_a2_file_valid(jsonb,text)','3330d1f6030574fe6bdfeb6b8b91e06d562b64737806a84d7d9838214017c172'),
    ('public.branding_a2_assets_valid(jsonb)','140b39fa960872412adbbccf35bad654745e9f9a743435d439944ae403f37ced'),
    ('public.branding_a2_logo_valid(jsonb,text)','f35c69107465a34c8107071b0f68a19b76b8c6e2b7c56098336904228e439ee0')
  ) AS expected(signature,hash) LOOP
    IF encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(dependency.signature)),'UTF8')),'hex')
        IS DISTINCT FROM dependency.hash THEN
      RAISE EXCEPTION 'A5_BASELINE_DIVERGENT: %',dependency.signature;
    END IF;
  END LOOP;
  -- The API deliberately reuses A2 CHECKs; function hashes alone cannot prove they exist.
  FOR dependency IN SELECT * FROM (VALUES
    ('store_config_accent_color_a2_check','881003fa8947e0d7a3c90667e39a0dc8158a9c57c789a590e5ca189a02d0ae9d'),
    ('store_config_secondary_color_a2_check','7eea1e4f45b5408e353dec13bf1fb0ae6c635ef384d9867b129c9898744f49cd'),
    ('store_config_branding_assets_a2_check','5fd37bd7cd412dd2d01c136adb5ad3e2a3ca0124b7cc7ac9741a3c64d57ba7b0'),
    ('store_config_branding_logo_a2_check','b6633e03045a29aac193b9653f02854626fa3f74e1aa4a7789dbb1febfa3d599')
  ) AS expected(name,hash) LOOP
    IF (SELECT encode(sha256(convert_to(pg_get_constraintdef(oid),'UTF8')),'hex')
        FROM pg_constraint WHERE conrelid='public.store_config'::regclass
          AND conname=dependency.name AND convalidated)
        IS DISTINCT FROM dependency.hash THEN
      RAISE EXCEPTION 'A5_BASELINE_DIVERGENT: %',dependency.name;
    END IF;
  END LOOP;
  IF encode(sha256(convert_to(pg_get_viewdef('public.v_store_config'::regclass,false),'UTF8')),'hex')
      IS DISTINCT FROM 'cc40a578d9210d3ff2f313bc8a373719e1f0a75204d0230a03a55d99eaced242'
    OR NOT COALESCE((SELECT 'security_invoker=on'=ANY(reloptions) FROM pg_class
      WHERE oid='public.v_store_config'::regclass),false) THEN
    RAISE EXCEPTION 'A5_BASELINE_DIVERGENT: public view';
  END IF;
END $preflight$;

CREATE SEQUENCE public.branding_a5_revision_seq AS bigint INCREMENT BY 1
  MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
REVOKE ALL ON SEQUENCE public.branding_a5_revision_seq FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.store_config
  ADD COLUMN identity_revision bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT store_config_identity_revision_a5_check CHECK (identity_revision >= 0);

CREATE FUNCTION public.branding_a5_track_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.identity_revision := pg_catalog.nextval('public.branding_a5_revision_seq'::regclass);
  ELSIF NEW.id IS DISTINCT FROM OLD.id OR
    ROW(NEW.store_name,NEW.store_city,NEW.store_state,NEW.primary_color,
        NEW.secondary_color,NEW.accent_color,NEW.logo_url,NEW.branding_assets)
    IS DISTINCT FROM
    ROW(OLD.store_name,OLD.store_city,OLD.store_state,OLD.primary_color,
        OLD.secondary_color,OLD.accent_color,OLD.logo_url,OLD.branding_assets) THEN
    NEW.identity_revision := pg_catalog.nextval('public.branding_a5_revision_seq'::regclass);
  ELSE
    -- ON CONFLICT also ran BEFORE INSERT: its candidate revision is not authoritative.
    NEW.identity_revision := OLD.identity_revision;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.branding_a5_track_revision() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER branding_a5_track_revision BEFORE INSERT OR UPDATE ON public.store_config
  FOR EACH ROW EXECUTE FUNCTION public.branding_a5_track_revision();

CREATE FUNCTION public.read_store_identity() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE current_row public.store_config%ROWTYPE;
BEGIN
  IF public.is_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='IDENTITY_PERMISSION';
  END IF;
  SELECT * INTO current_row FROM public.store_config WHERE id=1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='IDENTITY_MISSING';
  END IF;
  RETURN jsonb_build_object('revision',current_row.identity_revision::text,'identity',
    jsonb_build_object('store_name',current_row.store_name,'store_city',current_row.store_city,
      'store_state',current_row.store_state,'primary_color',current_row.primary_color,
      'secondary_color',current_row.secondary_color,'accent_color',current_row.accent_color,
      'logo_url',current_row.logo_url,'branding_assets',current_row.branding_assets));
END;
$function$;

CREATE FUNCTION public.save_store_identity(expected_revision text, expected_identity jsonb, desired_identity jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $function$
DECLARE
  current_row public.store_config%ROWTYPE;
  current_identity jsonb;
  written jsonb;
  document jsonb;
  field text;
  keys constant text[] := ARRAY['store_name','store_city','store_state','primary_color',
    'secondary_color','accent_color','logo_url','branding_assets'];
BEGIN
  IF public.is_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='IDENTITY_PERMISSION';
  END IF;
  -- Bound length before casting; transport is canonical decimal text, never a JS number.
  IF expected_revision IS NULL OR length(expected_revision)>19
      OR expected_revision !~ '^(0|[1-9][0-9]*)$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='IDENTITY_INVALID';
  END IF;
  IF expected_revision::numeric > 9223372036854775807 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='IDENTITY_INVALID';
  END IF;
  FOREACH document IN ARRAY ARRAY[expected_identity,desired_identity] LOOP
    IF jsonb_typeof(document) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='IDENTITY_INVALID';
    END IF;
    IF octet_length(convert_to(document::text,'UTF8'))>262144
      OR NOT document ?& keys OR document-keys <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='IDENTITY_INVALID';
    END IF;
    FOREACH field IN ARRAY keys LOOP
      IF jsonb_typeof(document->field) NOT IN ('null',
        CASE WHEN field='branding_assets' THEN 'object' ELSE 'string' END) THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='IDENTITY_INVALID';
      END IF;
    END LOOP;
  END LOOP;
  IF desired_identity->>'primary_color' IS NOT NULL AND
    (desired_identity->>'primary_color' !~ '^#[A-Fa-f0-9]{6}$'
      OR desired_identity->>'primary_color'='#000000') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='IDENTITY_INVALID';
  END IF;
  SELECT * INTO current_row FROM public.store_config WHERE id=1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='IDENTITY_MISSING';
  END IF;
  current_identity := jsonb_build_object('store_name',current_row.store_name,'store_city',current_row.store_city,
    'store_state',current_row.store_state,'primary_color',current_row.primary_color,
    'secondary_color',current_row.secondary_color,'accent_color',current_row.accent_color,
    'logo_url',current_row.logo_url,'branding_assets',current_row.branding_assets);
  IF current_row.identity_revision <> expected_revision::bigint
    OR current_identity IS DISTINCT FROM expected_identity THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='IDENTITY_CONFLICT';
  END IF;
  IF desired_identity IS DISTINCT FROM current_identity THEN
    BEGIN
      written := public.upsert_store_config(desired_identity);
    EXCEPTION WHEN check_violation THEN
      -- Native CHECK DETAIL contains the candidate row. Keep its SQLSTATE only.
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='IDENTITY_INVALID';
    END;
    SELECT * INTO current_row FROM public.store_config WHERE id=1;
    IF NOT FOUND OR jsonb_typeof(written) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='IDENTITY_WRITE_UNCONFIRMED';
    END IF;
    current_identity := jsonb_build_object('store_name',current_row.store_name,'store_city',current_row.store_city,
      'store_state',current_row.store_state,'primary_color',current_row.primary_color,
      'secondary_color',current_row.secondary_color,'accent_color',current_row.accent_color,
      'logo_url',current_row.logo_url,'branding_assets',current_row.branding_assets);
    IF NOT written ?& keys OR current_identity IS DISTINCT FROM desired_identity THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='IDENTITY_WRITE_UNCONFIRMED';
    END IF;
    FOREACH field IN ARRAY keys LOOP
      IF written->field IS DISTINCT FROM desired_identity->field THEN
        RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='IDENTITY_WRITE_UNCONFIRMED';
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('revision',current_row.identity_revision::text,'identity',current_identity);
END;
$function$;
REVOKE ALL ON FUNCTION public.read_store_identity(),public.save_store_identity(text,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_store_identity(),public.save_store_identity(text,jsonb,jsonb)
  TO authenticated,service_role;
COMMIT;
