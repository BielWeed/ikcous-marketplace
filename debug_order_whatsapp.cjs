const { Client } = require('pg');

async function debugOrder() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();

        console.log('--- Últimos Pedidos ---');
        const orders = await client.query('SELECT id, created_at, status, total_price FROM public.marketplace_orders ORDER BY created_at DESC LIMIT 5');
        console.table(orders.rows);

        console.log('\n--- Logs do pg_net (Últimas 5 chamadas) ---');
        // Verificando se a tabela net.http_request existe e tem dados
        try {
            const netLogs = await client.query('SELECT id, status, url, error_msg, created_at FROM net.http_request ORDER BY created_at DESC LIMIT 5');
            console.table(netLogs.rows);
        } catch (e) {
            console.log('Tabela net.http_request não encontrada ou sem acesso:', e.message);
        }

    } catch (err) {
        console.error('Erro na investigação:', err);
    } finally {
        await client.end();
    }
}

debugOrder();
