CREATE OR REPLACE FUNCTION public.handle_new_order_whatsapp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
            DECLARE
              request_id bigint;
            BEGIN
              SELECT net.http_post(
                url := 'https://db.cafkrminfnokvgjqtkle.supabase.co/functions/v1/send-order-whatsapp',
                headers := jsonb_build_object(
                  'Content-Type', 'application/json',
                  'apikey', (SELECT whatsapp_api_key FROM public.store_config WHERE id = 1)
                ),
                body := jsonb_build_object('record', row_to_json(NEW))::text
              ) INTO request_id;

              RETURN NEW;
            END;
            $function$
