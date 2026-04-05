const { Client } = require('pg');
const fs = require('node:fs');

async function getAdminRpcs() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });
    try {
        await client.connect();

        const rpcs = [
            'get_segmented_push_targets',
            'get_admin_customers_paged',
            'upsert_store_config',
            'reply_review_atomic',
            'answer_question_atomic',
            'update_order_status_atomic',
            'get_product_optimization_data',
            'get_coupon_stats',
            'swap_banner_order',
            'get_inventory_health',
            'get_category_analytics',
            'get_customer_intelligence',
            'get_retention_analytics',
            'get_retention_rate'
        ];

        let out = '';
        for (const rpc of rpcs) {
            const res = await client.query(`SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = $1`, [rpc]);
            if (res.rows.length > 0) {
                out += `\n--- RPC: ${rpc} ---\n`;
                out += res.rows[0].pg_get_functiondef;
                out += `\n----------------------\n`;
            } else {
                out += `\n--- RPC: ${rpc} NOT FOUND ---\n`;
            }
        }

        fs.writeFileSync('admin_rpcs_dump.sql', out);
        console.log('Saved to admin_rpcs_dump.sql');
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
getAdminRpcs();
