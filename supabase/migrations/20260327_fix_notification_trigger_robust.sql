-- 20260327_fix_notification_trigger_robust.sql
-- Goal: Restore app_settings and fix handle_new_order_whatsapp trigger authorization

BEGIN;

-- 1. Criar tabela app_settings se não existir
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Inserir placeholder para service_role se não existir
-- O usuário deve atualizar este valor manualmente no dashboard do Supabase
INSERT INTO public.app_settings (key, value, description)
VALUES ('supabase_service_role_key', 'YOUR_SERVICE_ROLE_KEY_HERE', 'Chave service_role para chamadas internas de Edge Functions')
ON CONFLICT (key) DO NOTHING;

-- 3. Atualizar a função de gatilho para ser mais robusta
CREATE OR REPLACE FUNCTION public.handle_new_order_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_apikey text;
BEGIN
  -- 1. Tenta obter do app_settings primeiro (mais estável)
  SELECT value INTO v_apikey FROM public.app_settings WHERE key = 'supabase_service_role_key';
  
  -- 2. Fallback para o header se o app_settings estiver vazio ou com o placeholder
  IF v_apikey IS NULL OR v_apikey = 'YOUR_SERVICE_ROLE_KEY_HERE' THEN
    BEGIN
      v_apikey := (current_setting('request.headers', true)::jsonb)->>'apikey';
    EXCEPTION WHEN OTHERS THEN
      v_apikey := NULL;
    END;
  END IF;

  -- 3. Se ainda nulo, não podemos autenticar, mas vamos logar o erro (opcional)
  IF v_apikey IS NULL OR v_apikey = '' THEN
    RAISE WARNING 'handle_new_order_whatsapp: Nenhuma API Key encontrada para autorização.';
  END IF;

  -- 4. Chamar a Edge Function
  PERFORM
    net.http_post(
      url := 'https://cafkrminfnokvgjqtkle.functions.supabase.co/send-order-whatsapp',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(v_apikey, '')
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'marketplace_orders',
        'record', row_to_json(NEW)::jsonb
      )
    );
  RETURN NEW;
END;
$$;

-- 4. Re-aplicar o gatilho (garantir que existe)
DROP TRIGGER IF EXISTS on_order_created_whatsapp ON public.marketplace_orders;
CREATE TRIGGER on_order_created_whatsapp
  AFTER INSERT ON public.marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_order_whatsapp();

COMMIT;
