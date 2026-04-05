const { Client } = require('pg');

async function checkOrder() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();

        console.log('--- Resumo Store Config ---');
        const config = await client.query('SELECT whatsapp_api_url, whatsapp_api_instance FROM public.store_config WHERE id = 1');
        console.table(config.rows);

        console.log('\n--- Último Pedido Completo ---');
        const order = await client.query('SELECT * FROM public.marketplace_orders ORDER BY created_at DESC LIMIT 1');
        if (order.rows.length > 0) {
            console.log(JSON.stringify(order.rows[0], null, 2));
        } else {
            console.log('Nenhum pedido encontrado.');
        }

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}

checkOrder();
