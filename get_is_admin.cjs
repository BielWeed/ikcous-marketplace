const { Client } = require('pg');
const fs = require('node:fs');

async function getAdminRpc() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query("SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'is_admin'");
        if (res.rows.length > 0) {
            fs.writeFileSync('is_admin_rpc.sql', res.rows[0].pg_get_functiondef);
            console.log('Saved to is_admin_rpc.sql');
        } else {
            console.log('Function is_admin not found');
        }
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
getAdminRpc();
