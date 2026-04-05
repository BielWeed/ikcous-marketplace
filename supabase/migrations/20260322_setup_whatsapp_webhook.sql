-- 20260322_setup_whatsapp_webhook.sql
-- Goal: Automate WhatsApp notifications via Database Webhooks

-- 1. Enable pg_net extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Create the trigger function
CREATE OR REPLACE FUNCTION public.handle_new_order_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Note: The URL matches the Project ID identified (cafkrminfnokvgjqtkle)
  -- This call is asynchronous via pg_net
  PERFORM
    net.http_post(
      url := 'https://cafkrminfnokvgjqtkle.functions.supabase.co/send-order-whatsapp',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('request.headers', true)::json->>'apikey' -- OPTIONAL: Forwarding apikey if needed
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

-- 3. Create the trigger
DROP TRIGGER IF EXISTS on_order_created_whatsapp ON public.marketplace_orders;
CREATE TRIGGER on_order_created_whatsapp
  AFTER INSERT ON public.marketplace_orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_order_whatsapp();

COMMENT ON FUNCTION public.handle_new_order_whatsapp() IS 'Trigger function to notify WhatsApp Edge Function on new orders.';
