const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyMigration() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- Aplicando Migração Solo-Ninja ---');

        const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20260303_solo_ninja_deep_security_v2.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        await client.query(sql);
        console.log('✅ Migração Solo-Ninja aplicada com sucesso: create_marketplace_order_v2 seguro!');

    } catch (err) {
        console.error('Erro ao aplicar migração:', err);
    } finally {
        await client.end();
    }
}

applyMigration();
