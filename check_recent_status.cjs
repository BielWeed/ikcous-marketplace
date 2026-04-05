const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkRecentOrders() {
    try {
        await client.connect();
        console.log('--- Últimos 5 pedidos inseridos ---');
        const res = await client.query(`
            SELECT id, customer_name, total, created_at, status
            FROM public.marketplace_orders 
            ORDER BY created_at DESC 
            LIMIT 5
        `);
        console.log(JSON.stringify(res.rows, null, 2));

        console.log('--- Verificando se o trigger handle_new_order_whatsapp existe e está ativo ---');
        const triggers = await client.query(`
            SELECT trigger_name, event_manipulation, action_statement, action_condition
            FROM information_schema.triggers
            WHERE event_object_table = 'marketplace_orders'
            AND trigger_name = 'on_order_created_whatsapp'
        `);
        console.log('Triggers:', JSON.stringify(triggers.rows, null, 2));

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
checkRecentOrders();
