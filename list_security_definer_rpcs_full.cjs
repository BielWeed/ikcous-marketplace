const { Client } = require('pg');
const fs = require('node:fs');

async function listSecurityDefinerRpcs() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT 
                n.nspname AS schema_name,
                p.proname AS function_name,
                pg_get_function_arguments(p.oid) AS arguments,
                pg_get_functiondef(p.oid) AS definition
            FROM 
                pg_proc p
            JOIN 
                pg_namespace n ON p.pronamespace = n.oid
            WHERE 
                p.prosecdef = true
                AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'extensions')
            ORDER BY schema_name, function_name;
        `);

        fs.writeFileSync('security_definer_rpcs.json', JSON.stringify(res.rows, null, 2));
        console.log('✅ Listagem completa. Dados salvos em security_definer_rpcs.json');

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

listSecurityDefinerRpcs();
