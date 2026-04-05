const { Client } = require('pg');

async function checkPolicies() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT tablename, policyname 
            FROM pg_policies 
            WHERE tablename IN ('orders', 'order_items')
        `);
        console.log('Existing Policies:', JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

checkPolicies();
