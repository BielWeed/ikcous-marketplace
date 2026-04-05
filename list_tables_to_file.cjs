const { Client } = require('pg');
const fs = require('node:fs');

async function listAllTables() {
    const client = new Client({
        connectionString: "postgresql://postgres:postgres@localhost:54322/postgres"
    });

    try {
        await client.connect();

        console.log('--- Public Tables (Full List) ---');
        const res = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);

        const tables = res.rows.map(r => r.table_name);
        fs.writeFileSync('all_public_tables.txt', tables.join('\n'));
        console.log(`Saved ${tables.length} tables to all_public_tables.txt`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

listAllTables();
