const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT
                n_tgt.nspname AS target_schema,
                cl_tgt.relname AS target_table
            FROM pg_constraint con
            JOIN pg_class cl_tgt ON cl_tgt.oid = con.confrelid
            JOIN pg_namespace n_tgt ON n_tgt.oid = cl_tgt.relnamespace
            WHERE con.conname = 'marketplace_orders_user_id_fkey'
        `);
        console.log('FK_SCHEMA:', res.rows[0].target_schema);
        console.log('FK_TABLE:', res.rows[0].target_table);
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
