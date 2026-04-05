const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function verify() {
    try {
        await client.connect();

        const userRes = await client.query('SELECT id FROM auth.users LIMIT 1');
        const testUserId = userRes.rows[0]?.id;
        console.log('Using Test User ID:', testUserId);

        await client.query(`SELECT set_config('role', 'authenticated', false)`);
        await client.query(`SELECT set_config('request.jwt.claims', json_build_object('sub', '${testUserId}')::text, false)`);

        const prodRes = await client.query('SELECT id, preco_venda FROM public.produtos WHERE ativo = true LIMIT 1');
        const product = prodRes.rows[0];

        const configRes = await client.query('SELECT free_shipping_min, shipping_fee FROM public.store_config WHERE id = 1');
        const config = configRes.rows[0];

        let subtotal = Number(product.preco_venda);
        let shipping = subtotal >= (config.free_shipping_min || 999999) ? 0 : (config.shipping_fee || 0);
        let total = subtotal + shipping;

        console.log(`Subtotal: ${subtotal}, Shipping: ${shipping}, Total: ${total}`);

        const items = JSON.stringify([{
            product_id: product.id,
            quantity: 1
        }]);

        console.log('--- Calling create_marketplace_order_v21 ---');
        const orderRes = await client.query(`
            SELECT public.create_marketplace_order_v21(
                p_items := '${items}'::jsonb,
                p_total_amount := ${total},
                p_shipping_cost := ${shipping},
                p_payment_method := 'pix',
                p_address_id := NULL,
                p_customer_name := 'Test Runner',
                p_customer_phone := '5511999999999'
            ) as order_id;
        `);

        const orderId = orderRes.rows[0]?.order_id;
        console.log('Order Creation Success! Order ID:', orderId);

        // 5. Check net.http_request_queue
        console.log('--- Checking net.http_request_queue ---');
        const queueRes = await client.query('SELECT id, url, status_code FROM net.http_request_queue ORDER BY created_at DESC LIMIT 1');
        console.log('Latest HTTP Request:', queueRes.rows[0]);

    } catch (err) {
        console.error('Verification Failed:', err.message);
        if (err.detail) console.error('Detail:', err.detail);
    } finally {
        await client.end();
    }
}
verify();
