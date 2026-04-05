const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function applyTrigger() {
    try {
        await client.connect();
        console.log('--- Aplicando Trigger de WhatsApp ---');

        await client.query('CREATE EXTENSION IF NOT EXISTS pg_net;');

        await client.query(`
            CREATE OR REPLACE FUNCTION public.handle_new_order_whatsapp()
            RETURNS TRIGGER
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public
            AS $$
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
            $$;
        `);

        await client.query('DROP TRIGGER IF EXISTS on_order_created_whatsapp ON public.marketplace_orders;');
        await client.query(`
            CREATE TRIGGER on_order_created_whatsapp
              AFTER INSERT ON public.marketplace_orders
              FOR EACH ROW EXECUTE FUNCTION public.handle_new_order_whatsapp();
        `);

        console.log('✅ Trigger e Função aplicadas com sucesso!');

    } catch (err) {
        console.error('❌ Erro ao aplicar trigger:', err.message);
    } finally {
        await client.end();
    }
}
applyTrigger();
