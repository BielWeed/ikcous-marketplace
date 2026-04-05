const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query("SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'marketplace_orders'");
        console.log('TRIGGERS_ATIVOS_NA_TABELA:', res.rows.map(r => r.trigger_name).join(', '));
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
check();
