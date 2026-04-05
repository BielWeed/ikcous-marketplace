const { Client } = require('pg');

async function countTablesDetailed() {
    const client = new Client({
        connectionString: "postgresql://postgres:postgres@localhost:54322/postgres"
    });

    try {
        await client.connect();

        console.log('--- Table Count per Schema ---');
        const countRes = await client.query(`
            SELECT table_schema, count(*) 
            FROM information_schema.tables 
            WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
            GROUP BY table_schema
        `);
        console.log(JSON.stringify(countRes.rows, null, 2));

        console.log('\n--- Searching for marketplace_orders ---');
        const searchRes = await client.query(`
            SELECT table_schema 
            FROM information_schema.tables 
            WHERE table_name = 'marketplace_orders'
        `);
        if (searchRes.rows.length > 0) {
            console.log('Found marketplace_orders in schemas:', searchRes.rows.map(r => r.table_schema).join(', '));
        } else {
            console.log('marketplace_orders NOT FOUND in information_schema.tables');
        }

        console.log('\n--- Checking current database and user ---');
        const envRes = await client.query(`SELECT current_database(), current_user`);
        console.log(envRes.rows[0]);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

countTablesDetailed();
