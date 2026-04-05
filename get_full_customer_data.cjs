const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query("SELECT customer_data FROM public.marketplace_orders WHERE user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1");
        console.log('FULL_CUSTOMER_DATA:', JSON.stringify(res.rows[0].customer_data, null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
