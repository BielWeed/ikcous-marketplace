const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT 
                tgname AS trigger_name,
                n.nspname AS function_schema,
                p.proname AS function_name,
                p.prosrc AS function_definition
            FROM pg_trigger t
            JOIN pg_proc p ON p.oid = t.tgfoid
            JOIN pg_namespace n ON n.oid = p.pronamespace
            JOIN pg_class c ON c.oid = t.tgrelid
            WHERE c.relname = 'marketplace_orders'
        `);
        console.log('--- TRIGGER FUNCTIONS ---');
        res.rows.forEach(r => {
            console.log(`[TRIGGER: ${r.trigger_name}]`);
            console.log(`[FUNCTION: ${r.function_schema}.${r.function_name}]`);
            console.log(`[DEFINITION]:\n${r.function_definition}\n`);
            console.log('='.repeat(50));
        });
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
