const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

// Load environment variables from app_mkt/.env
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error('DATABASE_URL is not set in environment!');
    process.exit(1);
}

const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        await client.connect();
        console.log('Successfully connected to Supabase PostgreSQL database.');

        console.log('\n--- Checking validate_coupon_secure_v2 ---');
        const resCoupon = await client.query(`
            SELECT 
                p.proname,
                pg_get_function_arguments(p.oid) as args,
                p.prosrc
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = 'validate_coupon_secure_v2'
        `);
        console.log(resCoupon.rows.map(r => ({ name: r.proname, args: r.args })));

        console.log('\n--- Checking create_marketplace_order_v22 ---');
        const resOrder = await client.query(`
            SELECT 
                p.proname,
                pg_get_function_arguments(p.oid) as args,
                p.prosrc
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = 'create_marketplace_order_v22'
        `);
        console.log(resOrder.rows.map(r => ({ name: r.proname, args: r.args })));

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}
run();
