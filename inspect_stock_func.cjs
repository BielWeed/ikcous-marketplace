const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function run() {
    try {
        await client.connect();

        // 1. Get source of check_item_stock
        const funcRes = await client.query(`
            SELECT pg_get_functiondef(p.oid) as source
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = 'check_item_stock'
        `);
        console.log('--- check_item_stock SOURCE ---');
        console.log(funcRes.rows[0]?.source);

        // 2. Check for triggers using this function
        const trigRes = await client.query(`
            SELECT tgname, tgrelid::regclass as table_name, tgenabled
            FROM pg_trigger
            WHERE tgfoid = (
                SELECT p.oid
                FROM pg_proc p
                JOIN pg_namespace n ON p.pronamespace = n.oid
                WHERE n.nspname = 'public' AND p.proname = 'check_item_stock'
                LIMIT 1
            )
        `);
        console.log('--- TRIGGERS USING IT ---');
        console.log(trigRes.rows);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
run();
