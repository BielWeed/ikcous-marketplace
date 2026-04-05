const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyMigration() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- Aplicando Migração de Hardening Final ---');

        const migrationPath = path.join(__dirname, '..', 'migrations', '20260305_final_security_sweep.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        await client.query(sql);
        console.log('✅ Migração aplicada com sucesso!');

        console.log('--- Verificando Resultado ---');
        const checkRes = await client.query("SELECT proname FROM pg_proc WHERE proname = 'create_marketplace_order_v2'");
        if (checkRes.rows.length > 0) {
            console.log('✅ Função create_marketplace_order_v2 restaurada.');
        } else {
            console.log('❌ Erro: Função create_marketplace_order_v2 não encontrada após migração.');
        }

    } catch (err) {
        console.error('Erro ao aplicar migração:', err);
    } finally {
        await client.end();
    }
}

applyMigration();
