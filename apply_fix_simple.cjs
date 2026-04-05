const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyMigration() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        const sql = fs.readFileSync('apply_fix_simple.sql', 'utf8');
        await client.connect();
        console.log('Applying simplified migration...');
        await client.query(sql);
        console.log('Migration applied successfully.');
    } catch (err) {
        console.error('Full Error:', err);
    } finally {
        await client.end();
    }
}

applyMigration();
