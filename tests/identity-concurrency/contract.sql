-- Synthetic fixtures, real roles. Removing comparison, trigger or permission checks breaks these assertions.
CREATE FUNCTION public.a5_reject(statement text, expected_state text, expected_message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = expected_state AND SQLERRM LIKE '%'||expected_message||'%' THEN RETURN; END IF;
  RAISE;
 END;
 RAISE EXCEPTION 'Expected rejection % %', expected_state, expected_message;
END $$;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111"}';
DO $$ DECLARE a jsonb; b jsonb; result jsonb; old_row jsonb; value jsonb; field text; rev text; bad text; BEGIN
 a := public.read_store_identity();
 PERFORM public.a2_assert(a->>'revision'='0' AND jsonb_typeof(a->'revision')='string' AND a-ARRAY['revision','identity']='{}','existing revision is textual zero');
 PERFORM public.a2_assert(a->'identity'='{"store_name":"Loja ficticia","store_city":null,"store_state":null,"primary_color":"#000000","secondary_color":null,"accent_color":null,"logo_url":"https://legacy.example/logo.png","branding_assets":null}'::jsonb,'raw legacy identity with all nulls, no fallback');
 b := a->'identity'||jsonb_build_object('store_name','Name B','store_city','City B','store_state','MG','primary_color','#123ABC','secondary_color','#abcdef','accent_color','#000000','branding_assets',public.a2_package(),'logo_url','https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/branding/'||(public.a2_package()#>>'{header,path}'));
 SELECT to_jsonb(s) INTO old_row FROM public.store_config s WHERE id=1;
 result := public.save_store_identity(a->>'revision',a->'identity',b);
 PERFORM public.a2_assert(result->'identity'=b AND result->>'revision'<>a->>'revision','complete desired package confirmed');
 PERFORM public.a2_assert((SELECT to_jsonb(s)-ARRAY['store_name','store_city','store_state','primary_color','secondary_color','accent_color','logo_url','branding_assets','identity_revision','updated_at']=old_row-ARRAY['store_name','store_city','store_state','primary_color','secondary_color','accent_color','logo_url','branding_assets','identity_revision','updated_at'] FROM public.store_config s WHERE id=1),'all operational columns retained');
 -- An UPDATE calling now() must be observable even within this transaction.
 UPDATE public.store_config SET updated_at='2001-01-01T00:00:00Z' WHERE id=1;
 SELECT to_jsonb(s) INTO old_row FROM public.store_config s WHERE id=1;
 -- jsonb reconstructed in the opposite key order is semantically identical.
 SELECT jsonb_object_agg(e.key,e.value ORDER BY e.key DESC) INTO b FROM jsonb_each(b) e;
 PERFORM public.a2_assert(public.save_store_identity(result->>'revision',b,b)=result,'no-op and reordered JSON equivalent');
 PERFORM public.a2_assert((SELECT to_jsonb(s)=old_row FROM public.store_config s WHERE id=1),'no-op preserves updated_at and revision');
 PERFORM public.upsert_store_config('{"shipping_fee":27.35,"identity_revision":777}');
 PERFORM public.a2_assert(public.read_store_identity()=result,'legacy operational write preserves revision');
 UPDATE public.store_config SET identity_revision=999 WHERE id=1;
 PERFORM public.a2_assert(public.read_store_identity()=result,'direct caller cannot choose revision');
 FOREACH field IN ARRAY ARRAY['store_name','store_city','store_state','primary_color','secondary_color','accent_color','logo_url','branding_assets'] LOOP
  a := public.read_store_identity();
  -- Clear each field independently; clear assets first when changing linked logo.
  IF field='logo_url' THEN
   UPDATE public.store_config SET branding_assets=NULL WHERE id=1;
   a := public.read_store_identity();
  END IF;
  IF field='branding_assets' THEN value := public.a2_package();
   UPDATE public.store_config SET logo_url='https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/branding/'||(public.a2_package()#>>'{header,path}') WHERE id=1;
   a := public.read_store_identity();
  ELSE value := 'null'::jsonb; END IF;
  b := jsonb_set(a->'identity',ARRAY[field],value);
  result := public.save_store_identity(a->>'revision',a->'identity',b);
  PERFORM public.a2_assert(result->'identity'=b AND result->>'revision'<>a->>'revision','each identity field changes revision: '||field);
 END LOOP;
 a := public.read_store_identity();
 b := a->'identity'||'{"store_name":"B discarded response"}';
 PERFORM public.save_store_identity(a->>'revision',a->'identity',b);
 PERFORM public.upsert_store_config('{"store_name":"C newer"}');
 PERFORM public.upsert_store_config(a->'identity');
 PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',a->>'revision',a->'identity',b),'P0001','IDENTITY_CONFLICT');
 PERFORM public.a2_assert(public.read_store_identity()->'identity'=a->'identity','ABA refuses stale B and preserves A');
 -- Same raw values after deletion/recreation or id movement are a different occurrence.
 a := public.read_store_identity(); DELETE FROM public.store_config WHERE id=1;
 PERFORM public.a5_reject('SELECT public.read_store_identity()','P0002','IDENTITY_MISSING');
 PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',a->>'revision',a->'identity',b),'P0002','IDENTITY_MISSING');
 PERFORM public.a2_assert(NOT EXISTS(SELECT 1 FROM public.store_config WHERE id=1),'missing API never inserts');
 PERFORM public.upsert_store_config(a->'identity'||'{"identity_revision":0}');
 PERFORM public.a2_assert(public.read_store_identity()->>'revision'<>a->>'revision','delete/recreate does not reuse revision');
 PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',a->>'revision',a->'identity',b),'P0001','IDENTITY_CONFLICT');
 a := public.read_store_identity();
 UPDATE public.store_config SET id=3,identity_revision=0 WHERE id=1;
 UPDATE public.store_config SET id=1,identity_revision=0 WHERE id=3;
 PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',a->>'revision',a->'identity',b),'P0001','IDENTITY_CONFLICT');
 INSERT INTO public.store_config(id,identity_revision) VALUES(4,9223372036854775807);
 PERFORM public.a2_assert((SELECT identity_revision>0 AND identity_revision<>9223372036854775807 FROM public.store_config WHERE id=4),'insert caller revision ignored');
 DELETE FROM public.store_config WHERE id=4;
 a := public.read_store_identity();
 SELECT to_jsonb(s) INTO old_row FROM public.store_config s WHERE id=1;
 FOREACH bad IN ARRAY ARRAY[NULL,'','00','01','-1','+1',' 1','1 ','1.0','1e1','9223372036854775808',repeat('9',1000)] LOOP
  PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',bad,a->'identity',a->'identity'),'22023','IDENTITY_INVALID');
 END LOOP;
 FOREACH value IN ARRAY ARRAY[NULL::jsonb,'null','[]','true','123','"str"','{}',(a->'identity')-'store_name',a->'identity'||'{"id":1}',a->'identity'||'{"store_name":1}',a->'identity'||'{"branding_assets":[]}',a->'identity'||jsonb_build_object('store_name',repeat('é',140000))] LOOP
  PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',a->>'revision',value,a->'identity'),'22023','IDENTITY_INVALID');
  PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',a->>'revision',a->'identity',value),'22023','IDENTITY_INVALID');
 END LOOP;
 FOREACH bad IN ARRAY ARRAY['#000000','#123','red','#12345g'] LOOP
  PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',a->>'revision',a->'identity',a->'identity'||jsonb_build_object('primary_color',bad)),'22023','IDENTITY_INVALID');
 END LOOP;
 PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',a->>'revision',a->'identity',a->'identity'||'{"branding_assets":{}}'),'23514','IDENTITY_INVALID');
 PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',a->>'revision',a->'identity',a->'identity'||'{"secondary_color":"invalid"}'),'23514','IDENTITY_INVALID');
 PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',a->>'revision',a->'identity'||'{"store_name":"wrong snapshot"}',a->'identity'),'P0001','IDENTITY_CONFLICT');
 PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)','9223372036854775807',a->'identity',a->'identity'),'P0001','IDENTITY_CONFLICT');
 PERFORM public.a2_assert((SELECT to_jsonb(s)=old_row FROM public.store_config s WHERE id=1),'all rejected arguments/checks are atomic');
END $$;
COMMIT;
SELECT 'PASS raw snapshot, full write, null clearing, reordered/no-op, operational retention, eight revision fields, ABA, missing/delete/recreate/id, forged revision, invalid bounds and atomicity';

BEGIN;
SET LOCAL ROLE anon;
SELECT public.a5_reject('SELECT public.read_store_identity()','42501','permission denied');
SELECT public.a5_reject('SELECT public.save_store_identity(NULL,NULL,NULL)','42501','permission denied');
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"22222222-2222-4222-8222-222222222222"}';
CREATE TEMP TABLE store_config(id bigint,identity_revision bigint);
CREATE FUNCTION pg_temp.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TEMP SEQUENCE branding_a5_revision_seq;
SELECT public.a5_reject('SELECT public.read_store_identity()','42501','IDENTITY_PERMISSION');
SELECT public.a5_reject('SELECT public.save_store_identity(NULL,NULL,NULL)','42501','IDENTITY_PERMISSION');
SELECT public.a2_assert(public.a2_no_rows('UPDATE public.store_config SET store_name=''attack'' WHERE id=1'),'RLS refuses customer update');
SELECT public.a5_reject('INSERT INTO public.store_config(id) VALUES(44)','42501','row-level security');
SET LOCAL request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111"}';
DO $$ DECLARE a jsonb; b jsonb; BEGIN
 a:=public.read_store_identity(); b:=a->'identity'||'{"store_name":"No temporary shadow"}';
 PERFORM public.a2_assert(public.save_store_identity(a->>'revision',a->'identity',b)->'identity'=b,'qualified table, admin and sequence resist temporary shadow');
 PERFORM public.a2_assert((SELECT count(*)=0 FROM pg_temp.store_config),'shadow table untouched');
END $$;
COMMIT;
BEGIN;
SET LOCAL ROLE service_role;
DO $$ DECLARE a jsonb; BEGIN
 a:=public.read_store_identity();
 PERFORM public.a2_assert(public.save_store_identity(a->>'revision',a->'identity',a->'identity')=a,'service_role is_admin and grants permit RPCs');
END $$;
COMMIT;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  EXECUTE format('SET LOCAL ROLE %I',role_name);
  PERFORM public.a5_reject('SELECT nextval(''public.branding_a5_revision_seq'')','42501','permission denied');
  PERFORM public.a5_reject('SELECT setval(''public.branding_a5_revision_seq'',1)','42501','permission denied');
  PERFORM public.a5_reject('SELECT public.branding_a5_track_revision()','42501','permission denied');
  RESET ROLE;
 END LOOP;
END $$;
SELECT 'PASS actual anon/customer/admin/service_role authorization, RLS, private sequence/trigger, temporary shadow resistance';

-- Owner advances only the synthetic sequence. The exact odd value is beyond Number safety.
SELECT setval('public.branding_a5_revision_seq',9007199254740992,true) IS NOT NULL;
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111"}';
UPDATE public.store_config SET store_name='Large exact revision' WHERE id=1;
DO $$ DECLARE a jsonb; b jsonb; BEGIN
 a:=public.read_store_identity();
 PERFORM public.a2_assert(a->>'revision'='9007199254740993' AND jsonb_typeof(a->'revision')='string','exact decimal beyond JS safe integer');
 b:=public.save_store_identity(a->>'revision',a->'identity',a->'identity'||'{"store_name":"Large exact saved"}');
 PERFORM public.a2_assert(b->>'revision'='9007199254740995','INSERT candidate and UPDATE allocate distinct exact revisions');
END $$;
COMMIT;
SELECT 'PASS revision 9007199254740993 read as exact text; saved revision 9007199254740995';
