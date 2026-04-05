const { Client } = require('pg');
const fs = require('node:fs');

async function applySql() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        console.log('Connecting to Supabase database...');
        await client.connect();

        console.log('Reading migration file...');
        const sql = fs.readFileSync('../migrations/20260304_revoke_insecure_coupon_rpc.sql', 'utf8');

        console.log('Applying SQL...');
        await client.query(sql);

        console.log('SQL Applied Successfully: Revoked insecure coupon RPC!');
    } catch (err) {
        console.error('Error applying SQL:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

applySql();
