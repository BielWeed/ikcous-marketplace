const { Client } = require('pg');

async function testOrderCoupon() {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres.cafkrminfnokvgjqtkle:IsaBiel%40hgfwq1@aws-0-us-west-2.pooler.supabase.com:6543/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();

        // 1. Get first active product
        const prodRes = await client.query("SELECT id, nome, preco_venda, estoque FROM public.produtos WHERE ativo = true LIMIT 1;");
        if (prodRes.rows.length === 0) {
            console.log('No active products found in DB to test.');
            return;
        }
        const product = prodRes.rows[0];
        console.log('Using product:', product);

        // 2. Insert a temporary percentage coupon
        console.log('Inserting percentage coupon PERC10 (10%)...');
        await client.query(`
            INSERT INTO public.coupons (code, type, value, active, min_purchase)
            VALUES ('PERC10', 'percentage', 10, true, 0)
            ON CONFLICT (code) DO NOTHING;
        `);

        // 3. Prepare order details
        // We will buy 1 item of the product.
        const qty = 1;
        const subtotal = Number(product.preco_venda) * qty;
        
        // Calculate shipping
        const storeConfigRes = await client.query("SELECT free_shipping_min, shipping_fee FROM public.store_config WHERE id = 1;");
        const storeConfig = storeConfigRes.rows[0];
        const shipping = subtotal >= Number(storeConfig.free_shipping_min) ? 0 : Number(storeConfig.shipping_fee);

        // Calculate expected discount using percentage (10%)
        const expectedDiscount = (subtotal * 10) / 100;
        const expectedTotal = subtotal + shipping - expectedDiscount;

        console.log(`Subtotal: ${subtotal}, Shipping: ${shipping}, Expected Discount: ${expectedDiscount}, Expected Total to send: ${expectedTotal}`);

        // Try to call create_marketplace_order_v22
        console.log('Calling create_marketplace_order_v22...');
        const items = JSON.stringify([{
            product_id: product.id,
            variant_id: null,
            quantity: qty
        }]);

        // We run in a transaction so we can rollback
        await client.query('BEGIN;');
        try {
            const orderRes = await client.query(
                `SELECT public.create_marketplace_order_v22($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    items,
                    expectedTotal, // p_total_amount (client-calculated total)
                    shipping,      // p_shipping_cost
                    'pix',         // p_payment_method
                    null,          // p_address_id
                    'PERC10',      // p_coupon_code
                    'Test Customer', // p_customer_name
                    '(11) 99999-9999', // p_customer_phone
                    'Test observation', // p_observation
                    null           // p_address_data
                ]
            );
            console.log('Success placing order! Order ID:', orderRes.rows[0].create_marketplace_order_v22);
        } catch (orderErr) {
            console.error('Order creation failed:', orderErr.message);
        }
        await client.query('ROLLBACK;');

        // Cleanup coupon
        await client.query("DELETE FROM public.coupons WHERE code = 'PERC10';");
        console.log('Cleanup completed.');

    } catch (err) {
        console.error('Error in test:', err);
    } finally {
        await client.end();
    }
}

testOrderCoupon();
