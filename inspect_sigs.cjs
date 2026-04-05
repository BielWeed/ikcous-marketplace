const { Client } = require('pg');
const fs = require('node:fs');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function findHttpPost() {
    try {
        await client.connect();

        const res = await client.query(`
            SELECT 
                n.nspname as schema_name,
                p.proname as function_name,
                pg_get_function_arguments(p.oid) as arguments,
                pg_get_function_result(p.oid) as return_type
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE p.proname = 'http_post'
            ORDER BY n.nspname;
        `);

        fs.writeFileSync('http_post_signatures.json', JSON.stringify(res.rows, null, 2));

        const ext = await client.query(`
            SELECT name, installed_version FROM pg_available_extensions WHERE name IN ('pg_net', 'http', 'pgsql-http');
        `);
        fs.writeFileSync('extensions_status.json', JSON.stringify(ext.rows, null, 2));

        console.log('✅ Signatures and extensions saved.');

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
findHttpPost();
