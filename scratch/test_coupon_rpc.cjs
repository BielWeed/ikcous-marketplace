const { Client } = require('pg');

async function testCouponRPC() {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:IsaBiel%40hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();

        // 1. Insert temporary coupon
        console.log('Inserting temporary coupon TEST10...');
        await client.query(`
            INSERT INTO public.coupons (code, type, value, active, usage_limit, usage_count, min_purchase)
            VALUES ('TEST10', 'percentage', 10, true, 5, 0, 50)
            ON CONFLICT (code) DO NOTHING;
        `);

        // 2. Query to ensure it's there
        const checkRes = await client.query("SELECT * FROM public.coupons WHERE code = 'TEST10';");
        console.log('Inserted coupon details:', JSON.stringify(checkRes.rows, null, 2));

        // 3. Test validate_coupon_secure_v2
        console.log('\n--- TESTING RPC WITH TEST10 (Subtotal: 100) ---');
        const rpcRes1 = await client.query("SELECT public.validate_coupon_secure_v2('TEST10', 100);");
        console.log('RPC result (100 subtotal):', JSON.stringify(rpcRes1.rows, null, 2));

        console.log('\n--- TESTING RPC WITH TEST10 (Subtotal: 30 - below min_purchase) ---');
        const rpcRes2 = await client.query("SELECT public.validate_coupon_secure_v2('TEST10', 30);");
        console.log('RPC result (30 subtotal):', JSON.stringify(rpcRes2.rows, null, 2));

        console.log('\n--- TESTING RPC WITH INVALID CODE ---');
        const rpcResInvalid = await client.query("SELECT public.validate_coupon_secure_v2('INVALID_CODE', 100);");
        console.log('RPC result (invalid code):', JSON.stringify(rpcResInvalid.rows, null, 2));

        // 4. Cleanup
        console.log('\nCleaning up temporary coupon...');
        await client.query("DELETE FROM public.coupons WHERE code = 'TEST10';");
        console.log('Cleanup completed.');

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

testCouponRPC();
