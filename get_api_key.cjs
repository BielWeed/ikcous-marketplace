const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function run() {
    try {
        await client.connect();
        const res = await client.query('SELECT whatsapp_api_key FROM public.store_config WHERE id = 1');
        console.log('API Key:', res.rows[0]?.whatsapp_api_key);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
run();
