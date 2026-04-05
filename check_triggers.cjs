const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkTrigger() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT trigger_name, event_manipulation, event_object_table, action_statement, action_timing
            FROM information_schema.triggers
            WHERE event_object_table = 'marketplace_orders'
        `);
        console.log('Triggers on marketplace_orders:', JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
checkTrigger();
