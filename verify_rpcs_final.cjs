const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function verifyAll() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();

        const expected = [
            'is_admin',
            'validate_coupon_secure_v2',
            'get_admin_analytics_v2',
            'get_orders_by_whatsapp_v3',
            'update_order_status_atomic',
            'create_marketplace_order_v21'
        ];

        const res = await client.query(`
            SELECT p.proname, pg_get_function_identity_arguments(p.oid) as signature
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public'
            AND p.proname = ANY($1)
        `, [expected]);

        let output = '--- VERIFICATION RESULTS ---\n';
        const foundNames = res.rows.map(r => r.proname);

        expected.forEach(name => {
            const matches = res.rows.filter(r => r.proname === name);
            if (matches.length === 1) {
                output += `[OK] ${name}(${matches[0].signature})\n`;
            } else if (matches.length > 1) {
                output += `[AMBIGUOUS] ${name} has ${matches.length} overloads:\n`;
                matches.forEach(m => output += `  - (${m.signature})\n`);
            } else {
                output += `[MISSING] ${name}\n`;
            }
        });
        output += '---------------------------\n';
        console.log(output);
        fs.writeFileSync(path.join(__dirname, 'verification_results_final.txt'), output);

    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

verifyAll();
