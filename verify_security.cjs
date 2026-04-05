const { Client } = require('pg');

async function verifyHardening() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        
        console.log('--- Verification Started ---');

        // 1. Try direct insertion into marketplace_orders (Should fail due to RLS/Missing Policy)
        console.log('Test 1: Attempting direct INSERT into marketplace_orders...');
        try {
            await client.query("INSERT INTO marketplace_orders (user_id, total_amount, status) VALUES ('00000000-0000-0000-0000-000000000000', 0, 'pending')");
            console.error('FAIL: Direct INSERT succeeded! RLS hardening failed.');
        } catch (err) {
            console.log('PASS: Direct INSERT blocked. Error:', err.message);
        }

        // 2. Check if legacy RPCs are gone
        console.log('\nTest 2: Checking if create_marketplace_order_v22 still exists...');
        const resV22 = await client.query("SELECT 1 FROM pg_proc WHERE proname = 'create_marketplace_order_v22'");
        if (resV22.rowCount === 0) {
            console.log('PASS: create_marketplace_order_v22 removed.');
        } else {
            console.error('FAIL: create_marketplace_order_v22 still exists.');
        }

        // 3. Verify canonical RPC exists
        console.log('\nTest 3: Verifying canonical create_marketplace_order exists...');
        const resCanonical = await client.query("SELECT 1 FROM pg_proc WHERE proname = 'create_marketplace_order'");
        if (resCanonical.rowCount > 0) {
            console.log('PASS: Canonical RPC exists.');
        } else {
            console.error('FAIL: Canonical RPC not found.');
        }

        console.log('\n--- Verification Finished ---');

    } catch (err) {
        console.error('Verification error:', err);
    } finally {
        await client.end();
    }
}

verifyHardening();
