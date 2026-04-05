const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function findHttpPost() {
    try {
        await client.connect();

        console.log('--- Finding all "http_post" functions ---');
        const res = await client.query(`
            SELECT 
                n.nspname as schema_name,
                p.proname as function_name,
                pg_get_function_arguments(p.oid) as arguments
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE p.proname = 'http_post'
            ORDER BY n.nspname;
        `);

        console.log(JSON.stringify(res.rows, null, 2));

        console.log('--- Checking available extensions ---');
        const ext = await client.query(`
            SELECT name, installed_version FROM pg_available_extensions WHERE name IN ('pg_net', 'http', 'pgsql-http');
        `);
        console.log(JSON.stringify(ext.rows, null, 2));

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
findHttpPost();
