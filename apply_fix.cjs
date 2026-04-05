const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyMigration() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });
    const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20260319_fix_get_my_complete_profile_rpc.sql');

    try {
        const sql = fs.readFileSync(migrationPath, 'utf8');
        await client.connect();
        console.log('Applying migration...');
        await client.query(sql);
        console.log('Migration applied successfully.');
    } catch (err) {
        console.error('Error applying migration:', err);
    } finally {
        await client.end();
    }
}

applyMigration();
