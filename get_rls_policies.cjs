const { Client } = require('pg');
const fs = require('node:fs');

async function getRlsPolicies() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });
    try {
        await client.connect();

        const res = await client.query(`
            SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check 
            FROM pg_policies 
            WHERE schemaname = 'public' 
            AND tablename IN ('marketplace_orders', 'marketplace_order_items', 'profiles', 'push_subscriptions', 'coupons', 'produtos')
            ORDER BY tablename, policyname;
        `);

        let out = '';
        for (const row of res.rows) {
            out += `\n--- Table: ${row.tablename} | Policy: ${row.policyname} | CMD: ${row.cmd} ---\n`;
            out += `ROLES: ${row.roles}\n`;
            out += `QUAL (USING): ${row.qual}\n`;
            out += `WITH CHECK: ${row.with_check}\n`;
        }

        fs.writeFileSync('rls_policies_dump.txt', out);
        console.log('Saved to rls_policies_dump.txt');
    } catch (e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
getRlsPolicies();
