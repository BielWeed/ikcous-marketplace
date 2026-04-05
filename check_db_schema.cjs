const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DB_CONFIG = {
    host: process.env.SUPABASE_DB_HOST || 'db.cafkrminfnokvgjqtkle.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
};

async function check() {
    const client = new Client(DB_CONFIG);
    try {
        await client.connect();
        
        console.log('Fetching full function definition...');
        const rpc = await client.query(`
            SELECT pg_get_functiondef(p.oid) as def
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE p.proname = 'create_marketplace_order_v22'
              AND n.nspname = 'public';
        `);
        if (rpc.rows.length > 0) {
            fs.writeFileSync('db_check_full_rpc.txt', rpc.rows[0].def);
            console.log('Output written to db_check_full_rpc.txt');
        } else {
            console.log('RPC v22 not found.');
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

check();
