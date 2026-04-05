const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyMigration() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- Aplicando Migração Inventory Bypass ---');

        const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20260307_fix_inventory_bypass.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        await client.query(sql);
        console.log('✅ Migração Inventory Bypass aplicada com sucesso!');

    } catch (err) {
        console.error('Erro ao aplicar migração:', err);
    } finally {
        await client.end();
    }
}

applyMigration();
