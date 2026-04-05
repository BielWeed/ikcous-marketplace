const { Client } = require('pg');

async function checkStoreConfig() {
    const client = new Client({
        connectionString: "postgresql://postgres:postgres@localhost:54322/postgres"
    });

    try {
        await client.connect();

        console.log('--- Public Tables ---');
        const tablesRes = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log(tablesRes.rows.map(r => r.table_name).join(', '));

        console.log('\n--- store_config content ---');
        const storeConfigRes = await client.query(`SELECT * FROM store_config`);
        console.log(JSON.stringify(storeConfigRes.rows, null, 2));

        console.log('\n--- net.http_request_queue status ---');
        const queueRes = await client.query(`SELECT count(*) FROM net.http_request_queue`);
        console.log('Queue count:', queueRes.rows[0].count);

        if (parseInt(queueRes.rows[0].count) > 0) {
            const queueSamples = await client.query(`SELECT * FROM net.http_request_queue ORDER BY id DESC LIMIT 2`);
            console.log('Last requests:', JSON.stringify(queueSamples.rows, null, 2));
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkStoreConfig();
