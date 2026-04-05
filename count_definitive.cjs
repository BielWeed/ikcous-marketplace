const { Client } = require('pg');
const fs = require('node:fs');

async function countTablesDefinitive() {
    const client = new Client({
        connectionString: "postgresql://postgres:postgres@localhost:54322/postgres"
    });

    try {
        await client.connect();

        const res = await client.query(`
            SELECT table_schema, count(*) 
            FROM information_schema.tables 
            WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
            GROUP BY table_schema
        `);

        fs.writeFileSync('definitive_table_counts.txt', JSON.stringify(res.rows, null, 2));
        console.log('Saved definitive counts.');

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

countTablesDefinitive();
