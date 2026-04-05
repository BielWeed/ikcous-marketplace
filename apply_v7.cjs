const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyMigration() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20260306_marketplace_v7_hardening.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('--- Iniciando Aplicação da Blindagem v7 ---');
        await client.query('BEGIN;');
        await client.query(sql);
        await client.query('COMMIT;');
        console.log('✅ Migração v7 aplicada com sucesso!');
    } catch (err) {
        await client.query('ROLLBACK;');
        console.error('❌ ERRO NA MIGRAÇÃO:', err.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

applyMigration();
