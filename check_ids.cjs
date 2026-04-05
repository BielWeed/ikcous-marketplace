const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();

        console.log('--- 5 users from auth.users ---');
        const authUsers = await client.query("SELECT id, email FROM auth.users LIMIT 5");
        console.log(JSON.stringify(authUsers.rows, null, 2));

        console.log('--- 5 orders from marketplace_orders ---');
        const orders = await client.query("SELECT id, user_id, customer_name FROM public.marketplace_orders LIMIT 5");
        console.log(JSON.stringify(orders.rows, null, 2));

        const constraint = await client.query(`
            SELECT pg_get_constraintdef(oid) 
            FROM pg_constraint 
            WHERE conname = 'marketplace_orders_user_id_fkey'
        `);
        console.log('Constraint Definition:', constraint.rows[0]?.pg_get_constraintdef);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
