const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

const client = new Client({
    connectionString: process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`
});

async function applyMigration() {
    const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20260327_fix_notification_trigger_robust.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    try {
        await client.connect();
        console.log('--- Conectado ao Supabase Remoto ---');

        await client.query(sql);
        console.log('--- Migração Aplicada com Sucesso! ---');
        console.log('Tabela app_settings criada e Trigger handle_new_order_whatsapp atualizado.');

    } catch (err) {
        console.error('ERRO AO APLICAR MIGRAÇÃO:', err.message);
    } finally {
        await client.end();
    }
}

applyMigration();
