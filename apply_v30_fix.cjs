const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyMigration() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20260330_product_soft_delete.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Applying migration v30 fix...');
        await client.query(sql);
        console.log('Migration v30 applied successfully!');
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

applyMigration();
