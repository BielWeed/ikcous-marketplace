const { Client } = require('pg');
const fs = require('node:fs');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        const res = await client.query("SELECT prosrc FROM pg_proc WHERE proname = 'handle_new_order_whatsapp'");
        fs.writeFileSync('c:\\Users\\Gabriel\\Downloads\\Kimi_Agent_Atualização v4\\app_mkt\\trigger_func.sql', res.rows[0].prosrc);
        console.log('Function source saved to trigger_func.sql');
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
check();
