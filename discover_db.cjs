const { Client } = require('pg');

async function discoverDatabase() {
    const client = new Client({
        connectionString: "postgresql://postgres:postgres@localhost:54322/postgres"
    });

    try {
        await client.connect();

        console.log('--- Non-Internal Schemas ---');
        const schemaRes = await client.query(`
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
        `);
        console.log(schemaRes.rows.map(r => r.schema_name).join(', '));

        console.log('\n--- All Tables by Schema ---');
        const tablesRes = await client.query(`
            SELECT table_schema, table_name 
            FROM information_schema.tables 
            WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
            ORDER BY table_schema, table_name
        `);

        const grouped = tablesRes.rows.reduce((acc, row) => {
            acc[row.table_schema] = acc[row.table_schema] || [];
            acc[row.table_schema].push(row.table_name);
            return acc;
        }, {});

        console.log(JSON.stringify(grouped, null, 2));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

discoverDatabase();
