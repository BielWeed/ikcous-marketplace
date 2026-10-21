-- Reverter o front primeiro. Nenhuma view ou funcao anterior foi alterada:
-- nao existe corpo vivo anterior a restaurar. A funcao nova permanece inerte.
-- Preserva integralmente o contato; nao apaga tabela, coluna nem dado.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $preflight_rollback_20261330$
BEGIN
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
        WHERE oid = to_regprocedure('public.salvar_config_mototaxi(text,text)'))
      IS DISTINCT FROM md5($corpo$
DECLARE
  resultado jsonb;
BEGIN
  IF NOT public.is_admin() OR NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.config_mototaxi (id, whatsapp, nome)
    VALUES (1, NULLIF(btrim(p_whatsapp), ''), NULLIF(btrim(p_nome), ''))
    ON CONFLICT (id) DO UPDATE SET whatsapp = EXCLUDED.whatsapp, nome = EXCLUDED.nome
    RETURNING jsonb_build_object('whatsapp', whatsapp, 'nome', nome) INTO resultado;
  RETURN resultado;
END;
$corpo$) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo do mototaxi desconhecido; rollback recusado.';
  END IF;
END $preflight_rollback_20261330$;
REVOKE ALL ON public.config_mototaxi FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.salvar_config_mototaxi(text, text) FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
