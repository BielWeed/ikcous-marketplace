const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query("SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
        console.log('--- ALL_PUBLIC_TABLES ---');
        res.rows.forEach(r => console.log(`${r.table_name.padEnd(30)} | ${r.table_type}`));
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
