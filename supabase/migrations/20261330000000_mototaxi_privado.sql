-- Contato de entrega EXCLUSIVO do painel. store_config tem SELECT publico:
-- excluir uma coluna da view nao impediria a leitura direta da tabela.
-- Nenhuma view, RPC ou linha preexistente e alterada.
-- Rollback conserva contato/tabela e revoga o acesso; reverter o front primeiro.
-- Transacao pertence ao aplicador; nunca aplicar automaticamente pelo front.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Nao adotar objeto desconhecido nem reabrir acesso depois de rollback.
DO $preflight_20261330$
BEGIN
  IF to_regclass('public.config_mototaxi') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'salvar_config_mototaxi') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: objetos do mototaxi ja existem; conferir 62a/62b antes de aplicar.';
  END IF;
END $preflight_20261330$;

CREATE TABLE public.config_mototaxi (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  whatsapp text,
  nome text,
  CONSTRAINT config_mototaxi_whatsapp_check CHECK (
    whatsapp IS NULL OR whatsapp ~ '^55(1[1-9]|2[12478]|3[1-578]|4[1-9]|5[13-5]|6[1-9]|7[134579]|8[1-9]|9[1-9])([2-5][0-9]{7}|9[0-9]{8})$'
  ),
  CONSTRAINT config_mototaxi_nome_check CHECK (nome IS NULL OR (length(nome) BETWEEN 1 AND 80 AND nome = btrim(nome)))
);
ALTER TABLE public.config_mototaxi ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.config_mototaxi FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.config_mototaxi TO authenticated;
GRANT ALL ON public.config_mototaxi TO service_role;

CREATE POLICY config_mototaxi_admin_select ON public.config_mototaxi
  FOR SELECT TO authenticated
  USING (public.is_admin() AND public.is_admin_atual());

CREATE OR REPLACE FUNCTION public.salvar_config_mototaxi(p_whatsapp text, p_nome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.salvar_config_mototaxi(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_config_mototaxi(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_config_mototaxi(text, text) TO service_role;
NOTIFY pgrst, 'reload schema';
