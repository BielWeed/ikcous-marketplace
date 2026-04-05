const { Client } = require('pg');
const fs = require('node:fs');

async function listFunctions() {
    const client = new Client({
        connectionString: "postgresql://postgres:postgres@localhost:54322/postgres"
    });

    try {
        await client.connect();

        console.log('--- Listing All Functions (excluding system) ---');
        const res = await client.query(`
            SELECT n.nspname as schema, p.proname as function
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
            ORDER BY schema, function
        `);

        const lines = res.rows.map(r => `${r.schema}.${r.function}`);
        fs.writeFileSync('all_functions_dump.txt', lines.join('\n'));
        console.log(`Saved ${lines.length} functions to all_functions_dump.txt`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

listFunctions();
