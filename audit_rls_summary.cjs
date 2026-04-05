const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function auditRLS() {
    try {
        await client.connect();
        const criticalTables = ['marketplace_orders', 'marketplace_order_items', 'produtos', 'product_variants', 'store_config', 'coupons', 'profiles', 'user_addresses'];
        
        const res = await client.query(`
            SELECT tablename, rowsecurity FROM pg_tables 
            WHERE schemaname = 'public' AND tablename = ANY($1)
        `, [criticalTables]);

        const status = {
            active: res.rows.filter(r => r.rowsecurity).map(r => r.tablename),
            inactive: res.rows.filter(r => !r.rowsecurity).map(r => r.tablename)
        };

        console.log('--- Resumo Auditoria RLS ---');
        console.log('Ativas:', status.active.join(', '));
        if (status.inactive.length > 0) {
            console.log('⚠️ INATIVAS:', status.inactive.join(', '));
        } else {
            console.log('✅ Todas as tabelas críticas têm RLS ativo.');
        }

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
auditRLS();
