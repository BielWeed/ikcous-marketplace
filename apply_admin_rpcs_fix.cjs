const { Client } = require('pg');
const fs = require('node:fs');

async function applyMigration() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });
    try {
        await client.connect();
        const sql = fs.readFileSync('./supabase/migrations/20240304_fix_admin_rpcs_auth.sql', 'utf8');
        await client.query(sql);
        console.log('✅ Applied 20240304_fix_admin_rpcs_auth.sql successfully!');
    } catch (e) {
        console.error('❌ Error applying migration:', e);
    } finally {
        await client.end();
    }
}
applyMigration();
