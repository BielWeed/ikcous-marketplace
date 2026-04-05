const { Client } = require('pg');

async function testTrigger() {
    const client = new Client({
        connectionString: "postgresql://postgres:postgres@localhost:54322/postgres"
    });

    try {
        await client.connect();

        console.log('Inserting test order...');
        await client.query(`
            INSERT INTO public.marketplace_orders (customer_name, customer_data, total) 
            VALUES ('Test User', '{"whatsapp": "11988887777"}', 100)
        `);

        console.log('Checking net.http_request_queue...');
        const res = await client.query(`
            SELECT id, method, url, headers, body 
            FROM net.http_request_queue 
            ORDER BY id DESC LIMIT 1
        `);

        if (res.rows.length > 0) {
            const req = res.rows[0];
            console.log('\n--- SUCCESS: Trigger captured ---');
            console.log('ID:', req.id);
            console.log('Method:', req.method);
            console.log('URL:', req.url);
            console.log('Headers:', JSON.stringify(req.headers, null, 2));
            console.log('Body:', JSON.stringify(req.body, null, 2));

            if (req.headers.Authorization.includes('YOUR_SERVICE_ROLE_KEY_HERE')) {
                console.log('\n[!] VERIFIED: Authorization header used the placeholder from app_settings.');
            } else {
                console.log('\n[?] Authorization header value:', req.headers.Authorization);
            }
        } else {
            console.log('\n--- FAILURE: No request found in queue ---');
        }

    } catch (err) {
        console.error('Error during verification:', err);
    } finally {
        await client.end();
    }
}

testTrigger();
