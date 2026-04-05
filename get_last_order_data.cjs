const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query("SELECT * FROM marketplace_orders ORDER BY created_at DESC LIMIT 1");
        console.log('LAST_ORDER_DATA:', JSON.stringify(res.rows[0], null, 2));
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
check();
