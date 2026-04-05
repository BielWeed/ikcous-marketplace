const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query("SELECT prosrc FROM pg_proc WHERE proname = 'handle_new_order_whatsapp'");
        console.log('--- Function handle_new_order_whatsapp ---');
        console.log(res.rows[0].prosrc);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
