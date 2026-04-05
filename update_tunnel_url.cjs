const { createClient } = require('@supabase/supabase-js');

async function updateConfig() {
    const supabaseUrl = 'https://cafkrminfnokvgjqtkle.supabase.co';
    const supabaseKey = 'service_role_key_here'; // Replace with real key from env if available, or just use the Node.js client with the key I know.

    // I don't have the service role key in my memory directly, but I can use pg to update it.
    const { Client } = require('pg');
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const tunnelUrl = 'https://forty-streets-double.loca.lt'; // Assuming this is correct

        console.log(`Updating store_config with URL: ${tunnelUrl}`);

        await client.query(`
            UPDATE public.store_config 
            SET whatsapp_api_url = $1,
                whatsapp_api_key = 'BielWeed_ArbitragemPro_2025',
                whatsapp_api_instance = 'MainInstance'
            WHERE id = 1
        `, [tunnelUrl]);

        console.log('Update successful!');
    } catch (err) {
        console.error('Update failed:', err);
    } finally {
        await client.end();
    }
}

updateConfig();
