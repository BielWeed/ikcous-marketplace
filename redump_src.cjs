const { Client } = require('pg');
const fs = require('node:fs');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function run() {
    try {
        await client.connect();

        const res = await client.query(`
            SELECT proname, prosrc 
            FROM pg_proc p 
            JOIN pg_namespace n ON p.pronamespace = n.oid 
            WHERE n.nspname = 'public' 
            AND p.proname IN ('create_marketplace_order_v21', 'check_item_stock')
        `);

        for (const row of res.rows) {
            fs.writeFileSync(`c:\\Users\\Gabriel\\Downloads\\${row.proname}_prosrc.sql`, row.prosrc);
            console.log(`Saved ${row.proname} source to Downloads`);
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
run();
