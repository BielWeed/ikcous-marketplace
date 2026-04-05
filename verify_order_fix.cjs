const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function verify() {
    try {
        await client.connect();

        // 1. Get a valid user_id
        const userRes = await client.query('SELECT id FROM auth.users LIMIT 1');
        const testUserId = userRes.rows[0]?.id;
        if (!testUserId) {
            console.error('No user found in auth.users');
            return;
        }
        console.log('Using Test User ID:', testUserId);

        // 2. Set the session user for auth.uid()
        await client.query(`SELECT set_config('role', 'authenticated', false)`);
        await client.query(`SELECT set_config('request.jwt.claims', json_build_object('sub', '${testUserId}')::text, false)`);

        // 3. Get a valid product and address
        const prodRes = await client.query('SELECT id FROM public.produtos WHERE ativo = true LIMIT 1');
        const productId = prodRes.rows[0]?.id;

        const addrRes = await client.query(`SELECT id FROM public.user_addresses WHERE user_id = '${testUserId}' LIMIT 1`);
        const addressId = addrRes.rows[0]?.id;

        if (!productId) {
            console.error('No active product found');
            return;
        }

        const items = JSON.stringify([{
            product_id: productId,
            quantity: 1
        }]);

        // 4. Call the RPC
        console.log('--- Calling create_marketplace_order_v21 ---');
        const orderRes = await client.query(`
            SELECT public.create_marketplace_order_v21(
                p_items := '${items}'::jsonb,
                p_total_amount := 0, -- RPC will calculate subtotal, but we need to pass something close or handle validation
                p_shipping_cost := 0,
                p_payment_method := 'pix',
                p_address_id := ${addressId ? `'${addressId}'::uuid` : 'NULL'},
                p_customer_name := 'Test Runner',
                p_customer_phone := '5511999999999'
            ) as order_id;
        `);

        console.log('Order Creation Result:', orderRes.rows[0]);

        // 5. Check net.http_request_queue
        const queueRes = await client.query('SELECT id, url, status_code FROM net.http_request_queue ORDER BY created_at DESC LIMIT 1');
        console.log('Latest HTTP Request:', queueRes.rows[0]);

    } catch (err) {
        console.error('Verification Failed:', err.message);
        if (err.detail) console.error('Detail:', err.detail);
        if (err.hint) console.error('Hint:', err.hint);
    } finally {
        await client.end();
    }
}
verify();
