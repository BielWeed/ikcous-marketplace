-- 20260321_cleanup_legacy_rpcs_v23.sql
-- Goal: Aggressively remove all legacy order RPCs by signature (Solo-Ninja)

BEGIN;

DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (
        SELECT proname, oidvectortypes(proargtypes) as args
        FROM pg_proc n 
        JOIN pg_namespace ns ON n.pronamespace = ns.oid 
        WHERE ns.nspname = 'public' 
          AND (proname LIKE 'create_marketplace_order_v%' OR proname LIKE 'create_marketplace_order' OR proname LIKE 'create_order%')
          AND proname != 'create_marketplace_order_v21'
    ) LOOP
        RAISE NOTICE 'Dropping function: %.%(%)', 'public', r.proname, r.args;
        EXECUTE 'DROP FUNCTION public.' || quote_ident(r.proname) || '(' || r.args || ') CASCADE';
    END LOOP;
END $$;

COMMIT;
