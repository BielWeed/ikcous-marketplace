const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkExtension() {
    try {
        await client.connect();

        console.log('--- Verificando se a extensão pg_net está instalada e habilitada ---');
        const res = await client.query(`
            SELECT * FROM pg_extension WHERE extname = 'pg_net'
        `);
        console.log('Extensões:', JSON.stringify(res.rows, null, 2));

        console.log('--- Verificando permissões da schema net ---');
        const perms = await client.query(`
            SELECT nspname, has_schema_privilege('postgres', nspname, 'USAGE') as has_usage
            FROM pg_namespace
            WHERE nspname = 'net'
        `);
        console.log('Permissões:', JSON.stringify(perms.rows, null, 2));

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
checkExtension();
