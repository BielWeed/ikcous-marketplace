const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT 
                tgname AS trigger_name,
                proname AS function_name,
                prosrc AS function_definition
            FROM pg_trigger
            JOIN pg_proc ON pg_proc.oid = tgfoid
            JOIN pg_class ON pg_class.oid = tgrelid
            WHERE relname = 'marketplace_orders'
        `);
        console.log('--- ALL_TRIGGERS_ON_MARKETPLACE_ORDERS ---');
        res.rows.forEach(r => {
            console.log(`Trigger: ${r.trigger_name} | Function: ${r.function_name}`);
            console.log(`Definition: ${r.function_definition.substring(0, 500)}...`);
            console.log('---------------------------------------------');
        });
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
