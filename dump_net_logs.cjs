const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function dump() {
    try {
        await client.connect();
        const res = await client.query("SELECT id, status, url, error_msg, created_at FROM net.http_request ORDER BY created_at DESC LIMIT 10");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
dump();
