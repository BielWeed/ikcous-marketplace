const { Client } = require('pg');
const fs = require('node:fs');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function run() {
    try {
        await client.connect();
        const res = await client.query(`
            SELECT pg_get_functiondef(p.oid) as source 
            FROM pg_proc p 
            JOIN pg_namespace n ON p.pronamespace = n.oid 
            WHERE n.nspname = 'public' AND p.proname = 'create_marketplace_order_v21'
        `);
        if (res.rows[0]) {
            fs.writeFileSync('rpc_v21.sql', res.rows[0].source);
            console.log('Source saved to rpc_v21.sql');
        } else {
            console.log('Function not found');
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
run();
