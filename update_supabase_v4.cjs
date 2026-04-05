const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`
});

async function update() {
    try {
        await client.connect();
        const query = "UPDATE store_config SET whatsapp_api_instance = 'Evolution_Miracle' WHERE id = 1 RETURNING *";
        const res = await client.query(query);
        console.log('✅ Supabase atualizado: Instância = Evolution_Miracle');
        console.log('Nova Instancia:', res.rows[0].whatsapp_api_instance);
    } catch (err) {
        console.error('ERRO AO ATUALIZAR SUPABASE:', err.message);
    } finally {
        await client.end();
    }
}

update();
