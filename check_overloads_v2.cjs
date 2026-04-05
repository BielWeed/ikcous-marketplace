const { Client } = require('pg');

async function listAllPublicFunctions() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
            SELECT p.proname, pg_get_function_identity_arguments(p.oid) as signature
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
            AND p.proname IN ('update_order_status_atomic', 'validate_coupon_secure_v2', 'create_marketplace_order_v21', 'get_admin_analytics_v2', 'get_orders_by_whatsapp_v3');
        `);

        let output = '--- FOUND RPCs ---\n';
        res.rows.forEach(row => {
            output += `${row.proname}(${row.signature})\n`;
        });
        output += '-------------------\n';
        console.log(output);
        fs.writeFileSync(path.join(__dirname, 'rpcs_found.txt'), output);
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

listAllPublicFunctions();
