const { Client } = require('pg');
async function check() {
    const client = new Client({ connectionString: process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres` });
    try {
        await client.connect();
        const tables = ['coupons', 'marketplace_orders', 'marketplace_order_items', 'produtos', 'product_variants'];
        for (const table of tables) {
            const res = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}'`);
            console.log(`${table.toUpperCase()}:`, JSON.stringify(res.rows.map(r => r.column_name)));
        }
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
check();
