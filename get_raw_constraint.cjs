const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT pg_get_constraintdef(oid) 
            FROM pg_constraint 
            WHERE conname = 'marketplace_orders_user_id_fkey'
        `);
        console.log('CONSTRAINT_DEF:', res.rows[0].pg_get_constraintdef);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
