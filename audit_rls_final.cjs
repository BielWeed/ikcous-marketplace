const { Client } = require('pg');
const DB_CONFIG = {
    connectionString: process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`
};

const CRITICAL_TABLES = [
    'marketplace_orders', 
    'marketplace_order_items', 
    'produtos', 
    'product_variants', 
    'store_config', 
    'coupons', 
    'profiles', 
    'user_addresses'
];

async function checkRLS() {
    const client = new Client(DB_CONFIG);
    try {
        await client.connect();
        
        console.log('--- Auditoria de RLS (Tabelas Críticas) ---');
        const res = await client.query(`
            SELECT tablename, rowsecurity FROM pg_tables 
            WHERE schemaname = 'public' AND tablename = ANY($1)
        `, [CRITICAL_TABLES]);

        res.rows.forEach(row => {
            if (row.rowsecurity) {
                console.log(`✅ Tabela ${row.tablename} tem RLS.`);
            } else {
                console.log(`⚠️ ALERTA: Tabela ${row.tablename} está sem RLS!`);
            }
        });

    } catch (err) {
        console.error('❌ Erro na auditoria:', err.message);
    } finally {
        await client.end();
    }
}
checkRLS();
