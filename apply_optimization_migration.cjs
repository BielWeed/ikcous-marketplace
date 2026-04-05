const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyMigration() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const sqlPath = 'c:/Users/Gabriel/Downloads/Kimi_Agent_Atualização v4/migrations/20260218_audit_part2_optimization.sql';
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Applying migration...');
        await client.query(sql);
        console.log('Migration applied successfully!');
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}

applyMigration();
