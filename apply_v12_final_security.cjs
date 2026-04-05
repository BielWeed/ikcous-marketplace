const { Client } = require('pg');
const fs = require('node:fs');
const path = require('path');

async function applyMigration() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        console.log('--- Aplicando Migração Final Solo-Ninja v12 (Consolidação de Segurança) ---');

        const migrationPath = path.join(__dirname, 'supabase', 'migrations', '20260309_solo_ninja_v12_final_security_consolidation.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        console.log('Executando SQL...');
        await client.query(sql);
        console.log('✅ Migração v12 aplicada com sucesso!');

        console.log('--- Verificando RPCs ---');
        const orderRpc = await client.query("SELECT proname FROM pg_proc WHERE proname = 'create_marketplace_order_v12'");
        const couponRpc = await client.query("SELECT proname FROM pg_proc WHERE proname = 'validate_coupon_secure_v2'");

        if (orderRpc.rows.length > 0 && couponRpc.rows.length > 0) {
            console.log('✅ RPCs v12 (Order e Coupon) confirmados no banco de dados.');
        } else {
            if (orderRpc.rows.length === 0) console.log('❌ Erro: create_marketplace_order_v12 não encontrado.');
            if (couponRpc.rows.length === 0) console.log('❌ Erro: validate_coupon_secure_v2 não encontrado.');
        }

        console.log('--- Verificando Limpeza de RPCs Legados ---');
        const legacyRpcs = await client.query("SELECT proname FROM pg_proc WHERE proname IN ('create_marketplace_order_v3', 'create_marketplace_order_v7', 'create_marketplace_order_v8', 'create_marketplace_order_v9', 'create_marketplace_order_v10', 'create_marketplace_order_v11')");
        if (legacyRpcs.rows.length === 0) {
            console.log('✅ Todos os RPCs legados foram removidos.');
        } else {
            console.log('⚠️ Alguns RPCs legados ainda existem:', legacyRpcs.rows.map(r => r.proname).join(', '));
        }

    } catch (err) {
        console.error('❌ Erro crítico ao aplicar migração:', err);
    } finally {
        await client.end();
    }
}

applyMigration();
