const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`
});

async function update() {
    try {
        await client.connect();
        const res = await client.query("UPDATE store_config SET whatsapp_api_instance = 'Evolution_Final' WHERE id = 1 RETURNING *");
        console.log('--- SUPABASE ATUALIZADO ---');
        console.log('Nova Instancia:', res.rows[0].whatsapp_api_instance);
    } catch (err) {
        console.error('ERRO AO ATUALIZAR SUPABASE:', err.message);
    } finally {
        await client.end();
    }
}

update();
