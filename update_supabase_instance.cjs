const { Client } = require('pg');
const supabaseConn = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;

async function updateInstance() {
    const client = new Client({ connectionString: supabaseConn });
    try {
        await client.connect();
        const res = await client.query("UPDATE store_config SET whatsapp_api_instance = 'Evolution_Prime' WHERE id = 1");
        console.log('SUCCESS: Instancia atualizada para Evolution_Prime');
    } catch (e) {
        console.error('ERROR:', e.message);
    } finally {
        await client.end();
    }
}
updateInstance();
