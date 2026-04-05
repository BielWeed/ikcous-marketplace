const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'marketplace_order_items'");
        console.log('COLUNAS_MARKETPLACE_ORDER_ITEMS:', res.rows.map(r => r.column_name).join(', '));
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
check();
