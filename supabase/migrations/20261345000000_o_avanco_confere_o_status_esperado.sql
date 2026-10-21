-- ADITIVA: porta nova, nao altera nenhuma funcao ou dado existente.
-- A comparacao e a gravacao ficam na mesma transacao e na mesma trava.
-- O front deve voltar ANTES do rollback-manual-20261345000000_o_avanco_confere_o_status_esperado.sql
-- Nenhum parametro e acrescentado a update_order_status_atomic (apps antigos preservados).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_345$
BEGIN
  IF to_regprocedure('public.is_admin_atual()') IS NULL
     OR to_regprocedure('public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.marketplace_orders')
       AND attname='id' AND atttypid='uuid'::regtype AND NOT attisdropped) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: dependencias do avanco ausentes ou assinatura diferente.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='avancar_status_do_pedido'
    AND (oid IS DISTINCT FROM to_regprocedure('public.avancar_status_do_pedido(uuid,text,text,text)')
      OR md5(replace(prosrc, chr(13), '')) IS DISTINCT FROM 'fa38bcea0cc69ffff200d8e2c81bd0d3'
      OR NOT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=public']
      OR prorettype <> 'jsonb'::regtype OR proretset)) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: avancar_status_do_pedido desconhecida; nada foi alterado.';
  END IF;
END $preflight_345$;

CREATE OR REPLACE FUNCTION public.avancar_status_do_pedido(
  p_order_id uuid,
  p_status_esperado text,
  p_new_status text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Cancelar tem outro fluxo e outra ordem de travas (ledger antes do pedido).
  -- Esta porta nunca pode chamar esse caminho segurando o pedido primeiro.
  IF p_new_status IS NULL OR p_new_status = 'cancelled' THEN
    RAISE EXCEPTION 'Use o cancelamento do pedido para cancelar.' USING ERRCODE = '22023';
  END IF;
  SELECT status INTO v_status FROM public.marketplace_orders
   WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_status IS DISTINCT FROM p_status_esperado THEN
    RAISE EXCEPTION 'pedido_status_mudou: O pedido mudou de situação enquanto você olhava. Atualize e tente de novo.';
  END IF;
  RETURN public.pedido__mudar_status(
    p_order_id, p_new_status, p_notes, auth.uid(), true, false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.avancar_status_do_pedido(uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.avancar_status_do_pedido(uuid,text,text,text) TO authenticated;

DO $conferencia_345$
BEGIN
  IF NOT COALESCE((SELECT md5(replace(prosrc,chr(13),''))='fa38bcea0cc69ffff200d8e2c81bd0d3' AND prosecdef
    AND proconfig=ARRAY['search_path=public'] AND prorettype='jsonb'::regtype AND NOT proretset
    AND has_function_privilege('authenticated',oid,'EXECUTE')
    AND NOT has_function_privilege('anon',oid,'EXECUTE')
    AND NOT has_function_privilege('service_role',oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(proacl,acldefault('f',proowner))) a
      WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
    FROM pg_proc WHERE oid=to_regprocedure('public.avancar_status_do_pedido(uuid,text,text,text)')),false) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo, atributos ou ACL do avanco divergentes.';
  END IF;
END $conferencia_345$;
NOTIFY pgrst, 'reload schema';
