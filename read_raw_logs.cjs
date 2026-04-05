const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function readLogs() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT id, status, url, error_msg, created_at 
            FROM net.http_request 
            ORDER BY created_at DESC LIMIT 5
        `);
        console.log('--- RAW NET LOGS ---');
        console.log(JSON.stringify(res.rows));
        console.log('--- END RAW NET LOGS ---');
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
readLogs();
