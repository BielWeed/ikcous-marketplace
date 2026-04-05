const { Client } = require('pg');
const fs = require('node:fs');

async function dumpFunc() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT pg_get_functiondef(p.oid) as def
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = 'create_marketplace_order_v9';
        `);

        const def = res.rows[0] ? res.rows[0].def : 'Function not found';
        fs.writeFileSync('v9_source.sql', def);
        console.log('Done!');
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

dumpFunc();
