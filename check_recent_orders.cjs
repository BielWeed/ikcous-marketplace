const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkOrders() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT id, customer_name, total, created_at, customer_data
            FROM public.marketplace_orders 
            ORDER BY created_at DESC LIMIT 5
        `);
        console.log('Recent Orders:', JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
checkOrders();
