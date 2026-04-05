const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkQueue() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT id, method, url, headers, body, timeout_milliseconds 
            FROM net.http_request_queue 
            ORDER BY id DESC LIMIT 5
        `);
        console.log('--- HTTP REQUEST QUEUE ---');
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
checkQueue();
