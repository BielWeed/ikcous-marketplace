const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT
                n.nspname AS referenced_schema,
                c.relname AS referenced_table
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.confrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE con.conname = 'marketplace_orders_user_id_fkey'
        `);
        console.log('FK_DETAILS:', JSON.stringify(res.rows[0], null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
