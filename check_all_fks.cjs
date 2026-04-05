const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT
                conname AS constraint_name,
                confrelid::regclass AS referenced_table,
                af.attname AS referenced_column
            FROM pg_constraint c
            JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1]
            INNER JOIN pg_class rel ON rel.oid = c.conrelid
            WHERE rel.relname = 'marketplace_orders' AND c.contype = 'f'
        `);
        console.log('ALL_FKS:', JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
