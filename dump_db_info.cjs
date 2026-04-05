const { Client } = require('pg');
const fs = require('node:fs');

async function dumpFullSchema() {
    const client = new Client({
        connectionString: "postgresql://postgres:postgres@localhost:54322/postgres"
    });

    try {
        await client.connect();

        console.log('--- Dumping all schemas and tables ---');
        const res = await client.query(`
            SELECT table_schema, table_name 
            FROM information_schema.tables 
            WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
            ORDER BY table_schema, table_name
        `);

        const lines = res.rows.map(r => `${r.table_schema}.${r.table_name}`);
        fs.writeFileSync('full_schema_dump.txt', lines.join('\n'));
        console.log(`Saved ${lines.length} items to full_schema_dump.txt`);

        console.log('\n--- Listing Databases ---');
        const dbRes = await client.query(`SELECT datname FROM pg_database WHERE datistemplate = false`);
        fs.writeFileSync('all_databases.txt', dbRes.rows.map(r => r.datname).join('\n'));
        console.log(`Saved ${dbRes.rows.length} databases to all_databases.txt`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

dumpFullSchema();
