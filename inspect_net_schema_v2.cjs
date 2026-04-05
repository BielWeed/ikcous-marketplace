const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function inspectNetSchema() {
    try {
        await client.connect();

        console.log('--- Listing all functions in "net" schema ---');
        const res = await client.query(`
            SELECT 
                p.proname as function_name,
                pg_get_function_arguments(p.oid) as arguments,
                pg_get_function_result(p.oid) as return_type
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'net'
            ORDER BY p.proname;
        `);

        console.log(JSON.stringify(res.rows, null, 2));

        console.log('--- Checking pg_net version ---');
        const version = await client.query(`
            SELECT extversion FROM pg_extension WHERE extname = 'pg_net';
        `);
        console.log('Version:', JSON.stringify(version.rows, null, 2));

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
inspectNetSchema();
