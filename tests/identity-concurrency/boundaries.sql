-- Byte limits and per-field type checks; probes roll back ordinary row changes.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111"}';
DO $$ DECLARE a jsonb; b jsonb; c jsonb; field text; invalid jsonb; remaining integer; old_row jsonb;
 message text; detail text; hint text; rejected boolean:=false; BEGIN
 a:=public.read_store_identity();
 SELECT to_jsonb(s) INTO old_row FROM public.store_config s WHERE id=1;
 BEGIN
  PERFORM public.save_store_identity(a->>'revision',a->'identity',a->'identity'||'{"store_name":"SYNTHETIC_PAYLOAD_MARKER","branding_assets":{"SYNTHETIC_PACKAGE_MARKER":true}}');
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS message=MESSAGE_TEXT,detail=PG_EXCEPTION_DETAIL,hint=PG_EXCEPTION_HINT;
  PERFORM public.a2_assert(message='IDENTITY_INVALID' AND coalesce(detail,'')='' AND coalesce(hint,'')='','CHECK diagnostic has fixed message and no candidate row/package');
  rejected:=true;
 END;
 PERFORM public.a2_assert(rejected AND (SELECT to_jsonb(s)=old_row FROM public.store_config s WHERE id=1),'sanitized CHECK rejection leaves no partial write');
 FOREACH field IN ARRAY ARRAY['store_name','store_city','store_state','primary_color','secondary_color','accent_color','logo_url','branding_assets'] LOOP
  FOREACH invalid IN ARRAY ARRAY['true'::jsonb,'1','[]'] LOOP
   b:=jsonb_set(a->'identity',ARRAY[field],invalid);
   PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',a->>'revision',b,a->'identity'),'22023','IDENTITY_INVALID');
   PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',a->>'revision',a->'identity',b),'22023','IDENTITY_INVALID');
  END LOOP;
 END LOOP;
 PERFORM public.a2_assert((SELECT to_jsonb(s)=old_row FROM public.store_config s WHERE id=1),'invalid types preserve full row');
 b:=jsonb_set(a->'identity','{store_name}','""');
 remaining:=262144-octet_length(convert_to(b::text,'UTF8'));
 b:=jsonb_set(b,'{store_name}',to_jsonb(repeat('é',remaining/2)||repeat('x',remaining%2)));
 PERFORM public.a2_assert(octet_length(convert_to(b::text,'UTF8'))=262144,'fixture exactly at UTF8 limit');
 c:=public.save_store_identity(a->>'revision',a->'identity',b);
 PERFORM public.a2_assert(c->'identity'=b,'exactly 262144 bytes accepted without text normalization');
 PERFORM public.a2_assert(public.save_store_identity(c->>'revision',b,b)=c,'expected JSON at byte limit accepted');
 b:=jsonb_set(b,'{store_name}',to_jsonb((b->>'store_name')||'x'));
 PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',c->>'revision',c->'identity',b),'22023','IDENTITY_INVALID');
 PERFORM public.a5_reject(format('SELECT public.save_store_identity(%L,%L,%L)',c->>'revision',b,c->'identity'),'22023','IDENTITY_INVALID');
 PERFORM public.a2_assert(public.read_store_identity()=c,'262145 bytes rejected atomically');
END $$;
ROLLBACK;
SELECT 'PASS UTF8 262144 accepted / 262145 refused for both JSONs; every field rejects boolean/number/array; CHECK diagnostics omit name/package and preserve full row';
