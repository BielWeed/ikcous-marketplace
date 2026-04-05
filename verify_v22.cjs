const { Client } = require('pg');

async function verifyHardening() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();

        console.log('--- Checking RLS Policies ---');
        const rlsRes = await client.query(`
            SELECT tablename, policyname, cmd, roles, qual, with_check 
            FROM pg_policies 
            WHERE schemaname = 'public' 
            AND tablename IN ('notificacoes', 'answers', 'push_subscriptions');
        `);
        console.table(rlsRes.rows);

        console.log('\n--- Checking for Legacy RPCs ---');
        const rpcRes = await client.query(`
            SELECT proname FROM pg_proc n 
            JOIN pg_namespace ns ON n.pronamespace = ns.oid 
            WHERE ns.nspname = 'public' AND proname LIKE 'create_marketplace_order_v%';
        `);
        console.log('Active Order RPCs:', rpcRes.rows.map(r => r.proname));

        const legacyFound = rpcRes.rows.filter(r => {
            const version = parseInt(r.proname.replace('create_marketplace_order_v', ''));
            return version < 21;
        });

        if (legacyFound.length === 0) {
            console.log('✅ Success: All legacy RPCs (v1-v20) have been removed.');
        } else {
            console.log('❌ Failure: Legacy RPCs still exist:', legacyFound.map(r => r.proname));
        }

    } catch (err) {
        console.error('Error during verification:', err);
    } finally {
        await client.end();
    }
}

verifyHardening();
