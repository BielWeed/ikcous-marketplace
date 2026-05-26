const { Client } = require('pg');
require('dotenv').config();

async function listOverloads() {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:IsaBiel%40hgfwq1@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT oid, pg_get_function_identity_arguments(oid) as args, pg_get_functiondef(oid) as def
            FROM pg_proc 
            WHERE proname = 'create_marketplace_order_v22';
        `);
        console.log('Overloads found:', res.rows.length);
        for (const row of res.rows) {
            console.log(`\n--- OID: ${row.oid} args: ${row.args} ---`);
            // print first few lines of def
            console.log(row.def.split('\n').slice(0, 15).join('\n'));
        }
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

listOverloads();
