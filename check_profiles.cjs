const { Client } = require('pg');

async function checkProfileColumns() {
    const client = new Client({
        connectionString: "postgresql://postgres:postgres@localhost:54322/postgres"
    });

    try {
        await client.connect();

        console.log('--- profiles columns ---');
        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'profiles'
        `);
        console.log(JSON.stringify(res.rows, null, 2));

        const samples = await client.query(`SELECT * FROM profiles LIMIT 3`);
        console.log('Sample data:', JSON.stringify(samples.rows, null, 2));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkProfileColumns();
