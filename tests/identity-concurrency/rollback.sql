-- Operational rollback: close only the new write API; never reset occurrence identifiers.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
REVOKE EXECUTE ON FUNCTION public.save_store_identity(text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
