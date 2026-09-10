-- All values are fictional. SQL roles/claims do not test HTTP JWT verification.
BEGIN;
CREATE FUNCTION public.a2_assert(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',label; END IF;
END $$;
CREATE FUNCTION public.a2_reject(statement text, expected_state text DEFAULT '23514') RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected_state THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Expected rejection %', expected_state;
END $$;
CREATE FUNCTION public.a2_no_rows(statement text) RETURNS boolean
LANGUAGE plpgsql AS $$ DECLARE changed integer; BEGIN EXECUTE statement; GET DIAGNOSTICS changed = ROW_COUNT; RETURN changed=0; END $$;
CREATE FUNCTION public.a2_file(filename text, width integer DEFAULT NULL, height integer DEFAULT NULL, mime text DEFAULT 'image/png') RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('path','v1/'||repeat('a',64)||'/'||filename,'sha256',repeat('a',64),'media_type',mime,'bytes',1234)
 || CASE WHEN width IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('width',width,'height',height) END;
$$;
CREATE FUNCTION public.a2_package() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('version',1,'originals',jsonb_build_array(public.a2_file('original.svg',NULL,NULL,'image/svg+xml')),
 'header',public.a2_file('header.png'), 'loader',public.a2_file('header.png'), 'favicon',public.a2_file('favicon.ico',NULL,NULL,'image/vnd.microsoft.icon'),
 'apple_touch',public.a2_file('apple.png',180,180), 'icon_192',public.a2_file('192.png',192,192),
 'icon_512',public.a2_file('512.png',512,512), 'maskable_512',public.a2_file('512.png',512,512), 'og',public.a2_file('og.jpg',1200,630,'image/jpeg'));
$$;
COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111"}';
DO $$ DECLARE result jsonb; old jsonb; BEGIN
 SELECT to_jsonb(s) INTO old FROM public.store_config s WHERE id=1;
 result := public.upsert_store_config(jsonb_build_object('secondary_color','#abcdef','accent_color','#000000','branding_assets',public.a2_package(),
  'logo_url','https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/branding/'||(public.a2_package()#>>'{header,path}')));
 PERFORM public.a2_assert(result->>'secondary_color'='#abcdef' AND result->>'accent_color'='#000000','colors retained, including new black');
 PERFORM public.a2_assert(result->'branding_assets'=public.a2_package(),'roundtrip package');
 PERFORM public.a2_assert(result-'secondary_color'-'accent_color'-'branding_assets'-'logo_url'-'updated_at'=old-'secondary_color'-'accent_color'-'branding_assets'-'logo_url'-'updated_at','all omitted old fields preserved');
 old := result;
 result := public.upsert_store_config('{}');
 PERFORM public.a2_assert(result-'updated_at'=old-'updated_at','empty old payload preserves entire row');
 result := public.upsert_store_config(jsonb_build_object('branding_assets',public.a2_package()));
 PERFORM public.a2_assert(result-'updated_at'=old-'updated_at','package-only update preserves matching omitted logo');
 result := public.upsert_store_config('{"store_name":"Nome editado"}');
 PERFORM public.a2_assert(result-'updated_at'-'store_name'=old-'updated_at'-'store_name','old RPC payload preserves package/home/color');
END $$;
COMMIT;
SELECT 'PASS admin roundtrip, empty/old payload, all omitted fields and package-only update';

BEGIN;
SET LOCAL ROLE anon;
SELECT public.a2_assert((SELECT count(*)=1 FROM public.v_store_config),'view filters id=1');
SELECT public.a2_assert((SELECT branding_assets=public.a2_package() AND secondary_color='#abcdef' FROM public.v_store_config),'anonymous reads full identity');
SELECT public.a2_reject($q$SELECT public.upsert_store_config('{"store_name":"attack"}')$q$,'42501');
SELECT public.a2_reject($q$INSERT INTO public.store_config(id) VALUES(3)$q$,'42501');
SELECT public.a2_assert(public.a2_no_rows($q$UPDATE public.store_config SET store_name='attack'$q$),'anon direct update denied');
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"22222222-2222-4222-8222-222222222222"}';
SELECT public.a2_reject($q$SELECT public.upsert_store_config('{"accent_color":"#112233"}')$q$,'P0001');
SELECT public.a2_reject($q$INSERT INTO public.store_config(id) VALUES(3)$q$,'42501');
SELECT public.a2_assert(public.a2_no_rows($q$UPDATE public.store_config SET store_name='attack'$q$),'customer direct update denied');
COMMIT;
SELECT 'PASS public read; anon/customer RPC and direct writes denied';

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111"}';
DO $$
DECLARE original jsonb; bad jsonb; cases jsonb[]; color jsonb; path text;
BEGIN
 SELECT to_jsonb(s) INTO original FROM public.store_config s WHERE id=1;
 cases := ARRAY[
  '{}'::jsonb, '[]'::jsonb, '"base64"'::jsonb,
  public.a2_package()-'header', public.a2_package()||'{"unknown":true}',
  public.a2_package()||'{"version":2}', public.a2_package()||'{"version":"1"}',
  public.a2_package()||'{"originals":[]}', public.a2_package()||'{"originals":null}',
  jsonb_set(public.a2_package(),'{originals}',(SELECT jsonb_agg(public.a2_file('o.png')) FROM generate_series(1,9))),
  jsonb_set(public.a2_package(),'{header}', 'null'),
  jsonb_set(public.a2_package(),'{header,secret}', '"forbidden"'),
  jsonb_set(public.a2_package(),'{header,bytes}', '0'),
  jsonb_set(public.a2_package(),'{header,bytes}', '20971521'),
  jsonb_set(public.a2_package(),'{header,bytes}', '1.5'),
  jsonb_set(public.a2_package(),'{header,bytes}', '"1234"'),
  jsonb_set(public.a2_package(),'{header,sha256}', to_jsonb(repeat('b',64))),
  jsonb_set(public.a2_package(),'{header,sha256}', to_jsonb(repeat('A',64))),
  jsonb_set(public.a2_package(),'{header,media_type}', '"text/html"'),
  jsonb_set(public.a2_package(),'{header,media_type}', '"image/jpeg"'),
  jsonb_set(public.a2_package(),'{header,width}', '1'),
  jsonb_set(public.a2_package(),'{header}',public.a2_file('header.png',0,1)),
  jsonb_set(public.a2_package(),'{header}',public.a2_file('header.png',8193,1)),
  jsonb_set(public.a2_package(),'{header}',public.a2_file('header.ico',NULL,NULL,'image/vnd.microsoft.icon')),
  jsonb_set(public.a2_package(),'{icon_192}',public.a2_file('192.png')),
  jsonb_set(public.a2_package(),'{icon_192}',public.a2_file('192.png',192,193)),
  jsonb_set(public.a2_package(),'{apple_touch}',public.a2_file('a.jpg',180,180,'image/jpeg')),
  jsonb_set(public.a2_package(),'{maskable_512}',public.a2_file('m.png',511,512)),
  jsonb_set(public.a2_package(),'{og}',public.a2_file('og.png',1200,629)),
  jsonb_set(public.a2_package(),'{og}',public.a2_file('og.svg',1200,630,'image/svg+xml')),
  jsonb_set(public.a2_package(),'{favicon}',public.a2_file('fav.jpg',NULL,NULL,'image/jpeg'))
 ];
 FOREACH path IN ARRAY ARRAY['https://foreign.invalid/a.png','v1/'||repeat('a',64)||'/../a.png',
  'v1/'||repeat('a',64)||'/header.png?x=1','v1/'||repeat('a',64)||'/header.png#x',
  'v1/'||repeat('a',64)||'/%61.png','v1/'||repeat('a',64)||'/a/b.png',
  'v1/'||repeat('a',64)||'/a\\b.png','v1/'||repeat('a',64)||'/'||repeat('a',81)||'.png'] LOOP
  cases := array_append(cases,jsonb_set(public.a2_package(),'{header,path}',to_jsonb(path)));
 END LOOP;
 FOREACH bad IN ARRAY cases LOOP
  PERFORM public.a2_reject(format('SELECT public.upsert_store_config(%L::jsonb)',jsonb_build_object('store_name','must rollback','branding_assets',bad,'logo_url',original->>'logo_url')));
  PERFORM public.a2_reject(format('UPDATE store_config SET branding_assets=%L::jsonb WHERE id=1',bad));
  PERFORM public.a2_assert((SELECT to_jsonb(s)=original FROM store_config s WHERE id=1),'invalid package leaves entire prior row untouched');
 END LOOP;
 FOREACH color IN ARRAY ARRAY['"red"'::jsonb,'"#123"','"#12345g"','123','true','{}'] LOOP
  PERFORM public.a2_reject(format('SELECT public.upsert_store_config(%L::jsonb)',jsonb_build_object('store_name','must rollback','secondary_color',color)));
 END LOOP;
 FOREACH path IN ARRAY ARRAY['https://foreign.invalid/a.png','http://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/branding/'||(public.a2_package()#>>'{header,path}'),
  (original->>'logo_url')||'?x=1',(original->>'logo_url')||'#x',(original->>'logo_url')||'x',
  replace(original->>'logo_url','https://','https://user@')] LOOP
  PERFORM public.a2_reject(format('SELECT public.upsert_store_config(%L::jsonb)',jsonb_build_object('store_name','must rollback','logo_url',path)));
 END LOOP;
 PERFORM public.a2_reject($q$UPDATE store_config SET logo_url=NULL WHERE id=1$q$);
 PERFORM public.a2_reject($q$UPDATE store_config SET accent_color='#XYZXYZ' WHERE id=1$q$);
 PERFORM public.a2_assert((SELECT to_jsonb(s)=original FROM store_config s WHERE id=1),'invalid linkage/colors remain atomic');
END $$;
SELECT public.upsert_store_config('{"branding_assets":null,"secondary_color":null,"accent_color":null,"logo_url":"https://legacy.example/any?legacy=1"}') IS NOT NULL;
SELECT public.a2_assert((SELECT branding_assets IS NULL AND secondary_color IS NULL AND accent_color IS NULL FROM store_config WHERE id=1),'explicit JSON null becomes SQL null');
SELECT public.upsert_store_config(jsonb_build_object('branding_assets',public.a2_package(),'secondary_color','#ABCDEF','accent_color','#123456','logo_url','https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/branding/'||(public.a2_package()#>>'{header,path}'))) IS NOT NULL;
COMMIT;
SELECT 'PASS malformed package/type/path/hash/dimensions/role/color/linkage rejected atomically; explicit NULL clears';

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111"}';
INSERT INTO storage.objects(bucket_id,name) VALUES('branding','v1/'||repeat('a',64)||'/header.png');
SELECT public.a2_reject($q$INSERT INTO storage.objects(bucket_id,name) VALUES('branding','v1/'||repeat('a',64)||'/header.png')$q$,'23505');
SELECT public.a2_assert(public.a2_no_rows($q$UPDATE storage.objects SET name='overwritten.png' WHERE bucket_id='branding'$q$),'no admin overwrite policy');
SELECT public.a2_reject($q$DELETE FROM storage.objects WHERE bucket_id='branding'$q$,'42501');
-- The Storage trigger forbids direct SQL DELETE before RLS. Also exercise RLS
-- with its documented local gate open, exclusively on synthetic test objects.
SET LOCAL storage.allow_delete_query='true';
SELECT public.a2_assert(public.a2_no_rows($q$DELETE FROM storage.objects WHERE bucket_id='branding'$q$),'no admin delete policy even through Storage delete gate');
SELECT public.a2_assert((SELECT count(*)=1 FROM storage.objects WHERE bucket_id='branding'),'denied deletion preserves object');
COMMIT;
BEGIN;
SET LOCAL ROLE anon;
SELECT public.a2_assert((SELECT count(*)=1 FROM storage.objects WHERE bucket_id='branding'),'public branding select');
SELECT public.a2_reject($q$INSERT INTO storage.objects(bucket_id,name) VALUES('branding','anon.png')$q$,'42501');
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"22222222-2222-4222-8222-222222222222"}';
SELECT public.a2_reject($q$INSERT INTO storage.objects(bucket_id,name) VALUES('branding','customer.png')$q$,'42501');
COMMIT;
SELECT public.a2_assert((SELECT public AND file_size_limit=20971520 AND cardinality(allowed_mime_types)=5 FROM storage.buckets WHERE id='branding'),'bucket configuration');
SELECT 'PASS bucket public read, admin insert, duplicate refused, no update/delete, anon/customer insert denied';
