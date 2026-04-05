const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

const DB_CONFIG = {
    connectionString: process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`
};

const PATCH_PATH = path.join(__dirname, 'security_patch.sql');

async function applySecurityPatch() {
    const client = new Client(DB_CONFIG);

    try {
        console.log('Conectando ao banco de dados...');
        await client.connect();
        
        if (!fs.existsSync(PATCH_PATH)) {
            throw new Error(`Arquivo não encontrado: ${PATCH_PATH}`);
        }
        
        const sql = fs.readFileSync(PATCH_PATH, 'utf8');

        console.log(`Aplicando patch de segurança: ${path.basename(PATCH_PATH)}...`);
        await client.query(sql);
        console.log('✅ Patch aplicado com sucesso!');
    } catch (err) {
        console.error('❌ Erro ao aplicar patch:', err.message);
        if (err.detail) console.error('Detalhe:', err.detail);
        process.exit(1);
    } finally {
        await client.end();
    }
}

applySecurityPatch();
