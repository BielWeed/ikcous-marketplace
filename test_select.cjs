const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function testSelect() {
    try {
        await client.connect();
        console.log('--- Testando SELECT marketplace_orders ---');
        const res = await client.query('SELECT count(*) FROM marketplace_orders');
        console.log('Resultado:', res.rows[0]);
    } catch (err) {
        console.error('ERRO NO SELECT:', err.message);
    } finally {
        await client.end();
    }
}
testSelect();
