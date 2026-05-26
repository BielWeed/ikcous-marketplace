const { Client } = require('pg');
const connectionString = 'postgresql://postgres:IsaBiel%40hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';

async function copyCart() {
    const client = new Client({ connectionString });
    try {
        await client.connect();
        
        // Find test user ID
        const userRes = await client.query("SELECT id FROM auth.users WHERE email = 'jetski.test.user.2026@gmail.com'");
        if (userRes.rows.length === 0) {
            console.log('Test user not found');
            return;
        }
        const testUserId = userRes.rows[0].id;
        console.log(`Test user ID: ${testUserId}`);

        // Delete existing items for test user
        await client.query("DELETE FROM public.cart_items WHERE user_id = $1", [testUserId]);

        // Copy items from main user
        const mainUserId = '5256dc84-0a48-40a1-8316-966b64fb4620';
        const copyRes = await client.query(`
            INSERT INTO public.cart_items (user_id, product_id, quantity, variant_id, created_at, updated_at)
            SELECT $1, product_id, quantity, variant_id, NOW(), NOW()
            FROM public.cart_items
            WHERE user_id = $2
        `, [testUserId, mainUserId]);

        console.log(`Copied ${copyRes.rowCount} items to test user cart.`);

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

copyCart();
