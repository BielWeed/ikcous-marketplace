const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function fixTriggerFinal() {
    try {
        await client.connect();

        console.log('--- Atualizando a função handle_new_order_whatsapp (VERSÃO FINAL) ---');
        // Usando whatsapp_api_key (que é o nome real da coluna na store_config)
        // E garantindo JSON válido via jsonb_build_object
        await client.query(`
            CREATE OR REPLACE FUNCTION public.handle_new_order_whatsapp()
            RETURNS trigger
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public, net
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
            $function$;
        `);

        console.log('✅ Função atualizada com sucesso!');

    } catch (err) {
        console.error('Erro ao atualizar função:', err.message);
    } finally {
        await client.end();
    }
}
fixTriggerFinal();
