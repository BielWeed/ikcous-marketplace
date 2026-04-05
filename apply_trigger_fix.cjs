const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

const sql = `
CREATE OR REPLACE FUNCTION public.handle_new_order_whatsapp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
            DECLARE
              request_id bigint;
              v_api_key text;
            BEGIN
              -- Standardize the API key retrieval
              SELECT whatsapp_api_key INTO v_api_key FROM public.store_config WHERE id = 1;

              SELECT net.http_post(
                url := 'https://cafkrminfnokvgjqtkle.supabase.co/functions/v1/send-order-whatsapp',
                headers := jsonb_build_object(
                  'Content-Type', 'application/json',
                  'apikey', COALESCE(v_api_key, '')
                ),
                body := jsonb_build_object('record', row_to_json(NEW))
              ) INTO request_id;

              RETURN NEW;
            END;
            $function$;
`;

async function applyFix() {
    try {
        await client.connect();
        await client.query(sql);
        console.log('Trigger function handle_new_order_whatsapp updated successfully.');
    } catch (err) {
        console.error('Error applying fix:', err.message);
    } finally {
        await client.end();
    }
}
applyFix();
