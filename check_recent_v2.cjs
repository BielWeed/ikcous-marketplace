const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkRecentOrders() {
    try {
        await client.connect();
        console.log('--- Resumo dos últimos 2 pedidos ---');
        const res = await client.query(`
            SELECT id, customer_name, total, created_at, status
            FROM public.marketplace_orders 
            ORDER BY created_at DESC 
            LIMIT 2
        `);
        res.rows.forEach(r => console.log(`ID: ${r.id} | Nome: ${r.customer_name} | Total: ${r.total} | Criado em: ${r.created_at}`));

        console.log('--- Verificando Triggers em marketplace_orders ---');
        const triggers = await client.query(`
            SELECT trigger_name, action_statement
            FROM information_schema.triggers
            WHERE event_object_table = 'marketplace_orders'
        `);
        triggers.rows.forEach(t => console.log(`Trigger: ${t.trigger_name} | Ação: ${t.action_statement}`));

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
checkRecentOrders();
