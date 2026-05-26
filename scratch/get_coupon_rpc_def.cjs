const { Client } = require('pg');
require('dotenv').config();

async function getRPCDef() {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:IsaBiel%40hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT pg_get_functiondef(p.oid) as def
            FROM pg_proc p 
            JOIN pg_namespace n ON n.oid = p.pronamespace 
            WHERE n.nspname = 'public' AND proname = 'validate_coupon_secure_v2';
        `);
        if (res.rows.length > 0) {
            console.log('RPC Definition:');
            console.log(res.rows[0].def);
        } else {
            console.log('RPC validate_coupon_secure_v2 not found');
        }
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

getRPCDef();
