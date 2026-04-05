const { Client } = require('pg');

async function updateConfig() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const apiKey = '4296144a114008779090b83e370f2a96';

        console.log(`Updating store_config with correct API KEY.`);

        await client.query(`
            UPDATE public.store_config 
            SET whatsapp_api_key = $1
            WHERE id = 1
        `, [apiKey]);

        console.log('Update successful!');
    } catch (err) {
        console.error('Update failed:', err);
    } finally {
        await client.end();
    }
}

updateConfig();
