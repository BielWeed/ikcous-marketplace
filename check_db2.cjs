const { Client } = require('pg');
const fs = require('node:fs');

async function check() {
    const client = new Client({ connectionString: process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres` });
    try {
        await client.connect();

        const res = await client.query(`
            SELECT p.relname as table, c.conname, pg_get_constraintdef(c.oid) as def 
            FROM pg_constraint c
            JOIN pg_class p ON c.conrelid = p.oid
            WHERE c.conrelid IN ('public.produtos'::regclass, 'public.product_variants'::regclass, 'public.coupons'::regclass);
        `);

        const res2 = await client.query(`
            SELECT pg_get_functiondef(p.oid) as def
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = 'validate_coupon_secure';
        `);

        const output = {
            constraints: res.rows,
            coupon_func: res2.rows.length ? res2.rows[0].def : null
        };
        fs.writeFileSync('check_out.json', JSON.stringify(output, null, 2));
        console.log('Saved to check_out.json');
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}
check();
