const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT 
                conname as constraint_name, 
                pg_get_constraintdef(con.oid) as constraint_definition
            FROM pg_constraint con
            INNER JOIN pg_class rel ON rel.oid = con.conrelid
            INNER JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE rel.relname = 'marketplace_orders'
        `);
        console.log('CONSTRAINTS:', JSON.stringify(res.rows, null, 2));

        const triggers = await client.query(`
            SELECT trigger_name, action_timing, event_manipulation, action_statement
            FROM information_schema.triggers
            WHERE event_object_table = 'marketplace_orders'
        `);
        console.log('TRIGGERS:', JSON.stringify(triggers.rows, null, 2));

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
check();
