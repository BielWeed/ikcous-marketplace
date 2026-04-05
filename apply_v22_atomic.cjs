const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

const DB_CONFIG = {
    connectionString: process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`
};

const MIGRATION_PATH = path.join(__dirname, 'supabase', 'migrations', '20260324_atomic_inventory_v22.sql');

async function applyMigration() {
    const client = new Client(DB_CONFIG);

    try {
        await client.connect();
        
        if (!fs.existsSync(MIGRATION_PATH)) {
            throw new Error(`Migration file not found: ${MIGRATION_PATH}`);
        }

        const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');

        console.log(`Aplicando migração: ${path.basename(MIGRATION_PATH)}...`);
        await client.query(sql);
        console.log('✅ Migração v22 aplicada com thành công!');
    } catch (err) {
        console.error('❌ Erro ao aplicar migração:', err.message);
        if (err.detail) console.error('Detalhe:', err.detail);
        process.exit(1);
    } finally {
        await client.end();
    }
}

applyMigration();
