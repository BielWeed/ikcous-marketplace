const { Client } = require('pg');

async function checkConstraints() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT
                conname as constraint_name,
                pg_get_constraintdef(c.oid) as constraint_definition
            FROM
                pg_constraint c
            JOIN
                pg_namespace n ON n.oid = c.connamespace
            WHERE
                contype IN ('c', 'p', 'u', 'f')
                AND conrelid = 'public.marketplace_orders'::regclass;
        `);
        console.log('Constraints for marketplace_orders:');
        console.table(res.rows);
    } catch (err) {
        console.error('Error checking constraints:', err);
    } finally {
        await client.end();
    }
}

checkConstraints();
