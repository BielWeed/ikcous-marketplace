const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:IsaBiel@hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function runTest() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        console.log('Connected to Supabase Postgres database.');

        const user1 = '1b8d20be-6851-4f2f-974f-e66081b8d5a7';
        const user2 = 'd36dddd3-535c-4e43-a139-b1b707a5adc9';

        // Test 6: Public Order Reading Vulnerability
        console.log('\n=== TEST 6: Public Order Reading Vulnerability ===');
        try {
            await client.query('BEGIN;');
            
            // Insert mock orders for user 1 and user 2 as superuser
            await client.query(`
                INSERT INTO public.marketplace_orders (id, user_id, total, subtotal, status, customer_name, customer_data)
                VALUES ('10000000-0000-0000-0000-000000000001', '${user1}', 50.00, 50.00, 'pending', 'User 1', '{}'::jsonb)
                ON CONFLICT (id) DO UPDATE SET user_id = '${user1}';
                
                INSERT INTO public.marketplace_orders (id, user_id, total, subtotal, status, customer_name, customer_data)
                VALUES ('10000000-0000-0000-0000-000000000002', '${user2}', 10.0, 10.0, 'pending', 'User 2', '{}'::jsonb)
                ON CONFLICT (id) DO UPDATE SET user_id = '${user2}';
            `);

            // Switch to anonymous user
            await client.query('SET LOCAL ROLE anon;');
            console.log('Querying marketplace_orders as anonymous user...');
            const selectRes = await client.query(`
                SELECT id, customer_name, total FROM public.marketplace_orders 
                WHERE id IN ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002');
            `);
            console.log(`Orders visible to anonymous user: ${selectRes.rows.length}`);
            selectRes.rows.forEach(r => {
                console.log(`- ID: ${r.id} | Customer: ${r.customer_name} | Total: ${r.total}`);
            });
            if (selectRes.rows.length > 0) {
                console.log('🔴 VULNERABILITY CONFIRMED: Public anonymous users can read customer order details!');
            } else {
                console.log('🟢 SECURE: Order reading restricted for public anonymous users.');
            }
        } catch (e) {
            console.log(`Error checking order reading: ${e.message}`);
        } finally {
            await client.query('ROLLBACK;');
        }

    } catch (err) {
        console.error('Connection/Test Error:', err);
    } finally {
        await client.end();
    }
}

runTest();
