-- Rollback manual da 20261345000000. Voltar o FRONT ANTES: a porta nova deixara de existir.
-- Remove so a RPC nova, nunca pedidos, estoque, ledger ou as portas antigas.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight_rollback_345$
BEGIN
  IF NOT COALESCE((SELECT md5(replace(prosrc,chr(13),''))='fa38bcea0cc69ffff200d8e2c81bd0d3' AND prosecdef
      AND proconfig=ARRAY['search_path=public'] AND prorettype='jsonb'::regtype
      FROM pg_proc WHERE oid=to_regprocedure('public.avancar_status_do_pedido(uuid,text,text,text)')),false)
    OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname='avancar_status_do_pedido') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: avancar_status_do_pedido ausente ou alterada; revisar antes de desfazer.';
  END IF;
END $preflight_rollback_345$;
DROP FUNCTION public.avancar_status_do_pedido(uuid,text,text,text);
NOTIFY pgrst, 'reload schema';
