const { Client } = require('pg');
const fs = require('node:fs');

async function getRPCDef() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT prosrc 
            FROM pg_proc p 
            JOIN pg_namespace n ON n.oid = p.pronamespace 
            WHERE n.nspname = 'public' AND proname = 'create_marketplace_order_v14';
        `);
        if (res.rows.length > 0) {
            fs.writeFileSync('rpc_def.sql', res.rows[0].prosrc);
            console.log('Definition saved to rpc_def.sql');
        } else {
            console.log('RPC not found');
        }
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

getRPCDef();
