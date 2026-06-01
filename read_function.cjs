const { Client } = require('pg');
const connectionString = 'postgresql://postgres:IsaBiel%40hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query("SELECT prosrc FROM pg_proc WHERE proname = 'prevent_role_change'");
        console.log('--- Function prevent_role_change ---');
        console.log(res.rows[0]?.prosrc || 'Function not found');
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
