const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyRemediation() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- Aplicando Remediação de Segurança (RLS & RPC) ---');

        const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20260303_security_remediation_final.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        console.log('Executando SQL...');
        await client.query(sql);
        console.log('✅ Migração aplicada com sucesso!');

        console.log('--- Verificando Políticas ---');
        const rlsRes = await client.query(`
            SELECT tablename, policyname, roles, cmd, qual 
            FROM pg_policies 
            WHERE schemaname = 'public' 
            AND tablename IN ('marketplace_orders', 'coupons')
        `);
        console.table(rlsRes.rows);

    } catch (err) {
        console.error('❌ Erro ao aplicar remediação:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

applyRemediation();
