const { Client } = require('pg');

async function searchKeys() {
    const client = new Client({
        connectionString: "postgresql://postgres:postgres@localhost:54322/postgres"
    });

    try {
        await client.connect();

        // List all tables
        const tablesRes = await client.query(`
            SELECT table_schema, table_name 
            FROM information_schema.tables 
            WHERE table_schema IN ('public', 'auth', 'storage')
        `);

        console.log('Tables found:', tablesRes.rows.length);

        for (const row of tablesRes.rows) {
            // Check for columns with 'key', 'secret', or 'token' in the name
            const columnsRes = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_schema = $1 AND table_name = $2
                AND (column_name ILIKE '%key%' OR column_name ILIKE '%secret%' OR column_name ILIKE '%token%')
            `, [row.table_schema, row.table_name]);

            if (columnsRes.rows.length > 0) {
                for (const col of columnsRes.rows) {
                    console.log(`Checking Table: ${row.table_schema}.${row.table_name}, Column: ${col.column_name}`);
                    try {
                        const dataRes = await client.query(`SELECT "${col.column_name}" FROM "${row.table_schema}"."${row.table_name}" LIMIT 5`);
                        if (dataRes.rows.length > 0) {
                            console.log('Sample Data:', dataRes.rows);
                        }
                    } catch (e) {
                        // Ignore errors (e.g. bytea columns)
                    }
                }
            }
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

searchKeys();
