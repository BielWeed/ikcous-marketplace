const { Client } = require('pg');

async function cleanAndRepair() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();

        console.log('Finding and dropping ambiguous functions...');

        // Find all overloads for the functions we want to repair
        const findRes = await client.query(`
            SELECT n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as signature
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
            AND p.proname IN ('update_order_status_atomic', 'validate_coupon_secure_v2', 'create_marketplace_order_v21', 'get_admin_analytics_v2', 'get_orders_by_whatsapp_v3');
        `);

        for (const row of findRes.rows) {
            console.log(`Dropping: ${row.name}(${row.signature})`);
            await client.query(`DROP FUNCTION IF EXISTS public."${row.name}"(${row.signature}) CASCADE`);
        }

        console.log('Ambiguous functions dropped. Now applying new migration...');

        const fs = require('node:fs');
        const path = require('path');
        const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20260323_repair_missing_rpcs_v25.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        await client.query(sql);
        console.log('Repair migration applied successfully!');

    } catch (err) {
        console.error('ERRO FATAL:');
        console.error(err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

cleanAndRepair();
