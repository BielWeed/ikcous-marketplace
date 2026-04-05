const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function testHttpCall() {
    try {
        await client.connect();

        console.log('--- Testing direct net.http_post with positional args ---');
        try {
            const res1 = await client.query(`
                SELECT net.http_post(
                    'https://httpbin.org/post'::TEXT,
                    '{"test": "pos"}'::JSONB
                );
            `);
            console.log('Positional Success:', res1.rows[0]);
        } catch (e) {
            console.log('Positional Failure:', e.message);
        }

        console.log('--- Testing direct net.http_post with named args ---');
        try {
            const res2 = await client.query(`
                SELECT net.http_post(
                    url := 'https://httpbin.org/post'::TEXT,
                    body := '{"test": "named"}'::JSONB
                );
            `);
            console.log('Named Success:', res2.rows[0]);
        } catch (e) {
            console.log('Named Failure:', e.message);
        }

        console.log('--- Testing with specific order from trigger ---');
        try {
            const res3 = await client.query(`
                SELECT net.http_post(
                    url := 'https://httpbin.org/post'::TEXT,
                    headers := '{"Content-Type": "application/json"}'::JSONB,
                    body := '{"test": "trigger_style"}'::JSONB
                );
            `);
            console.log('Trigger Style Success:', res3.rows[0]);
        } catch (e) {
            console.log('Trigger Style Failure:', e.message);
        }

    } catch (err) {
        console.error('Critical Error:', err.message);
    } finally {
        await client.end();
    }
}
testHttpCall();
