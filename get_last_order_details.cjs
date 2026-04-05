const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT 
                user_id, 
                customer_name, 
                status, 
                total, 
                subtotal, 
                shipping, 
                discount, 
                payment_method,
                customer_data
            FROM public.marketplace_orders 
            WHERE user_id IS NOT NULL 
            ORDER BY created_at DESC 
            LIMIT 1
        `);
        const row = res.rows[0];
        console.log('--- ORDER_DETAILS ---');
        for (const [key, value] of Object.entries(row)) {
            console.log(`${key}: ${JSON.stringify(value)}`);
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
