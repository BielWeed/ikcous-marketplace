-- =============================================================================
-- ROLLBACK de 20260805120000_otp_aponta_para_o_projeto_certo.sql
-- =============================================================================
--
-- Restaura o corpo de `handle_new_otp_verification` exatamente como estava vivo
-- em 05/08/2026, lido com `pg_get_functiondef` antes do apply.
--
-- AVISO: este rollback devolve um estado QUEBRADO, e isso é proposital. O corpo
-- restaurado posta para
--   https://jvgyjlbjhbfrncwbytls.functions.supabase.co/send-otp-email
-- onde a função send-otp-email não está publicada — todo POST responde 404, e o
-- convidado não recebe o código. Rollback significa "voltar ao que era", não
-- "corrigir de outro jeito".
--
-- Só rode isto se a migration tiver causado um problema PIOR do que o 404. Se o
-- problema for a credencial, o caminho barato é corrigir o segredo do Vault:
--
--   SELECT vault.update_secret(
--       (SELECT id FROM vault.secrets WHERE name = 'otp_trigger_secret'),
--       '<o mesmo valor que está em OTP_TRIGGER_SECRET na edge function>'
--   );
--
-- O trigger `on_otp_created_send_email` não é tocado nem lá nem aqui.
--
-- Sem `BEGIN`/`COMMIT`, pelo mesmo motivo explicado no cabeçalho da migration:
-- quem abre a transação é o `db-apply.cjs`.
--
-- ATENÇÃO AO REGERAR: `node scripts/db-apply.cjs` SOBRESCREVE este arquivo com
-- uma versão automática, sem nenhum destes comentários — é o INFRA-280 (#140).
-- Confirmado na prática em 05/08/2026: um `--dry-run` apagou esta documentação.
-- Se você rodar o db-apply e este cabeçalho sumir, recupere-o do git antes de
-- commitar. O corpo SQL gerado automaticamente é equivalente ao daqui.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_otp_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_apikey text;
BEGIN
  -- 1. Try to get service_role API key from app_settings first
  SELECT value INTO v_apikey FROM public.app_settings WHERE key = 'supabase_service_role_key';

  -- 2. Fallback to headers if settings placeholder is present or missing
  IF v_apikey IS NULL OR v_apikey = 'YOUR_SERVICE_ROLE_KEY_HERE' THEN
    BEGIN
      v_apikey := (current_setting('request.headers', true)::jsonb)->>'apikey';
    EXCEPTION WHEN OTHERS THEN
      v_apikey := NULL;
    END;
  END IF;

  -- 3. Trigger HTTP request to our send-otp-email Edge Function (updated to jvgyjlbjhbfrncwbytls)
  PERFORM
    net.http_post(
      url := 'https://jvgyjlbjhbfrncwbytls.functions.supabase.co/send-otp-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(v_apikey, '')
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'otp_verifications',
        'record', row_to_json(NEW)::jsonb
      )
    );
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.handle_new_otp_verification() IS NULL;

REVOKE EXECUTE ON FUNCTION public.handle_new_otp_verification()
    FROM PUBLIC, anon, authenticated;

-- O segredo do Vault NÃO é apagado aqui de propósito: ele não faz mal parado, não
-- abre nada além do envio de OTP, e apagá-lo obrigaria a regerar o par nos dois
-- lados se a migration for reaplicada.
-- Para remover: DELETE FROM vault.secrets WHERE name = 'otp_trigger_secret';
-- Nesse caso, remova também o OTP_TRIGGER_SECRET do ambiente da edge function —
-- segredo órfão de um lado só é ruído que confunde o próximo diagnóstico.
