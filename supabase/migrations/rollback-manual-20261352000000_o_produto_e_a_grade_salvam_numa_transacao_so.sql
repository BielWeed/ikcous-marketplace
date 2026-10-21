-- Rollback manual da 20261352000000: voltar primeiro o front.
-- Só apaga a porta nova. Nenhum produto, estoque ou variação é reescrito.
-- Repetir é no-op; função com corpo desconhecido é recusada.
DO $rollback_352$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
    AND proname = 'salvar_produto_com_grade'
    AND (oid <> COALESCE(to_regprocedure('public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])'), 0)
      OR md5(replace(prosrc, E'\r\n', E'\n')) <> '09c2a4b5724acbe46fb2c2e758e96c8f')) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: salvar_produto_com_grade desconhecida; nada foi apagado.';
  END IF;
END $rollback_352$;
DROP FUNCTION IF EXISTS public.salvar_produto_com_grade(uuid, timestamptz, jsonb, jsonb, uuid[]);
NOTIFY pgrst, 'reload schema';
