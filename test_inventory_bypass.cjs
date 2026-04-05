const { Client } = require('pg');
const fs = require('node:fs');

async function testInventoryBypass() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();

        const resProd = await client.query(`SELECT id, estoque, nome FROM public.produtos LIMIT 1;`);

        if (resProd.rows.length === 0) return;

        const productId = resProd.rows[0].id;
        const currentStock = resProd.rows[0].estoque;
        const quantityToBuy = (currentStock || 0) + 1000;

        const orderData = {
            p_items: JSON.stringify([{ product_id: productId, variant_id: null, quantity: quantityToBuy }]),
            p_payment_method: 'pix',
            p_address_id: null,
            p_customer_name: 'Hacker',
            p_customer_phone: '11999999999'
        };

        await client.query(`SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000000", "role":"authenticated"}';`);

        const resOrder = await client.query(`
            SELECT public.create_marketplace_order_v9(
                $1::jsonb, $2::text, $3::uuid, NULL, $4::text, $5::text, NULL
            ) AS result;
        `, [orderData.p_items, orderData.p_payment_method, orderData.p_address_id, orderData.p_customer_name, orderData.p_customer_phone]);

        fs.writeFileSync('test_out.json', JSON.stringify(resOrder.rows[0].result, null, 2));

    } catch (err) {
        fs.writeFileSync('test_out.json', JSON.stringify({ error_message: err.message }, null, 2));
    } finally {
        await client.end();
    }
}

testInventoryBypass();
