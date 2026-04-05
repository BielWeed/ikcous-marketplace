const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyMigration() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20260315_final_ninja_hardening.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Applying migration 20260315_final_ninja_hardening.sql...');
        await client.query(sql);
        console.log('Migration applied successfully!');
    } catch (err) {
        console.error('Erro:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

applyMigration();
