const { Client } = require('pg');

async function updateConfig() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const tunnelUrl = 'https://tired-deer-speak.loca.lt';

        console.log(`Updating store_config with URL: ${tunnelUrl}`);

        await client.query(`
            UPDATE public.store_config 
            SET whatsapp_api_url = $1
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
