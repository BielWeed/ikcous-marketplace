const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function run() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT 
                id, 
                method, 
                url, 
                headers::text as headers_txt, 
                body::text as body_txt
            FROM net.http_request_queue 
            ORDER BY id DESC 
            LIMIT 1
        `);
        console.log('--- LATEST QUEUED HTTP REQUEST ---');
        console.log(JSON.stringify(res.rows[0], null, 2));
    } catch (err) {
        console.error('Error fetching queue:', err.message);
    } finally {
        await client.end();
    }
}
run();
