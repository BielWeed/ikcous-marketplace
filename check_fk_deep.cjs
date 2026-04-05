const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT
                conname AS constraint_name,
                n_src.nspname AS source_schema,
                cl_src.relname AS source_table,
                n_tgt.nspname AS target_schema,
                cl_tgt.relname AS target_table
            FROM pg_constraint con
            JOIN pg_class cl_src ON cl_src.oid = con.conrelid
            JOIN pg_namespace n_src ON n_src.oid = cl_src.relnamespace
            JOIN pg_class cl_tgt ON cl_tgt.oid = con.confrelid
            JOIN pg_namespace n_tgt ON n_tgt.oid = cl_tgt.relnamespace
            WHERE con.conname = 'marketplace_orders_user_id_fkey'
        `);
        console.log('EXTENDED_FK_DETAILS:', JSON.stringify(res.rows[0], null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
