
            DECLARE
              v_apikey text;
            BEGIN
              -- Tenta obter a apikey do header de forma segura
              BEGIN
                v_apikey := (current_setting('request.headers', true)::jsonb)->>'apikey';
              EXCEPTION WHEN OTHERS THEN
                v_apikey := NULL;
              END;

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
            