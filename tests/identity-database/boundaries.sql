-- Remaining contract boundaries; every row is synthetic. Roll back all probes.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111"}';
DO $$ DECLARE package jsonb; result jsonb; before_row jsonb; BEGIN
 SELECT to_jsonb(s) INTO before_row FROM public.store_config s WHERE id=1;
 -- All eight originals may share bytes. Exercise both byte/dimension limits and
 -- the longest safe filename (76 ASCII characters + four-character extension).
 package := jsonb_set(public.a2_package(),'{originals}',
   (SELECT jsonb_agg(public.a2_file(repeat('x',76)||'.PNG',CASE WHEN n=1 THEN 1 ELSE 8192 END,CASE WHEN n=1 THEN 1 ELSE 8192 END)
     || jsonb_build_object('bytes',CASE WHEN n=1 THEN 1 ELSE 20971520 END)) FROM generate_series(1,8) n));
 result := public.upsert_store_config(jsonb_build_object('branding_assets',package,'secondary_color','#000000','accent_color','#FFFFFF'));
 PERFORM public.a2_assert(result->'branding_assets'=package AND result->>'secondary_color'='#000000' AND result->>'accent_color'='#FFFFFF','valid extreme limits persist exactly');
 result := public.upsert_store_config(jsonb_build_object('branding_assets',NULL,'secondary_color',NULL));
 PERFORM public.a2_assert(result->'branding_assets'='null' AND result->'secondary_color'='null' AND result->>'accent_color'='#FFFFFF' AND result->>'logo_url'=before_row->>'logo_url','explicit null clears only requested fields and preserves omitted logo/accent');
 result := public.upsert_store_config('{}');
 PERFORM public.a2_assert(result->'branding_assets'='null' AND result->'secondary_color'='null' AND result->>'accent_color'='#FFFFFF','omission after clear does not resurrect identity');
 -- Removing id1 is legal only in this disposable transaction. id2 survives.
 DELETE FROM public.store_config WHERE id=1;
 PERFORM public.a2_reject(format('SELECT public.upsert_store_config(%L::jsonb)',jsonb_build_object('branding_assets',public.a2_package(),'store_name','must not insert')));
 PERFORM public.a2_assert(NOT EXISTS(SELECT 1 FROM public.store_config WHERE id=1),'package without initial logo refuses entire first insert');
 result := public.upsert_store_config(jsonb_build_object('store_name','First configuration','branding_assets',package,'secondary_color','#aBcDeF','accent_color','#000000',
   'logo_url','https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/branding/'||(package#>>'{header,path}')));
 PERFORM public.a2_assert(result->'branding_assets'=package AND result->>'secondary_color'='#aBcDeF' AND result->>'accent_color'='#000000','first insert persists identity');
 PERFORM public.a2_assert((SELECT count(*)=1 FROM public.v_store_config) AND (SELECT count(*)=2 FROM public.store_config),'first insert keeps singleton view and unrelated id2');
 DELETE FROM public.store_config WHERE id=1;
 result := public.upsert_store_config('{}');
 PERFORM public.a2_assert(result->'branding_assets'='null' AND result->'secondary_color'='null' AND result->'accent_color'='null' AND result->'logo_url'='null','first empty payload has optional null identity');
 DELETE FROM public.store_config WHERE id=1;
 result := public.upsert_store_config('{"branding_assets":null,"secondary_color":null,"accent_color":null}');
 PERFORM public.a2_assert(result->'branding_assets'='null' AND result->'secondary_color'='null' AND result->'accent_color'='null','first explicit null payload creates SQL null identity');
END $$;
ROLLBACK;
SELECT 'PASS valid limits bytes 1/20971520, dimensions 1/8192, 8 originals, filename 80; NULL/omission; initial INSERT and atomic missing-logo refusal';
