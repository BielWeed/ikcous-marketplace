BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111"}';
DO $$
DECLARE result jsonb;
BEGIN
  result := public.upsert_store_config('{"secondary_color":"#123456","accent_color":"#ABCDEF","branding_assets":null}');
  IF result->>'secondary_color' IS DISTINCT FROM '#123456'
     OR result->>'accent_color' IS DISTINCT FROM '#ABCDEF'
     OR NOT result ? 'branding_assets' THEN
    RAISE EXCEPTION 'A2_RED_RPC_DISCARDS_IDENTITY';
  END IF;
END $$;
ROLLBACK;
