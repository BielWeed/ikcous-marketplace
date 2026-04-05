const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function debugNet() {
    try {
        await client.connect();
        console.log('--- Verificando Pedidos e Triggers ---');
        const orders = await client.query("SELECT id, created_at, status FROM public.marketplace_orders ORDER BY created_at DESC LIMIT 3");
        console.log('Ultimos Pedidos:', JSON.stringify(orders.rows, null, 2));

        console.log('\n--- Tentativas de Webhook (net.http_request) ---');
        try {
            const netLogs = await client.query(`
                SELECT id, status, url, error_msg, created_at 
                FROM net.http_request 
                ORDER BY created_at DESC LIMIT 10
            `);
            console.log('Logs de Rede:', JSON.stringify(netLogs.rows, null, 2));
        } catch (e) {
            console.log('Aviso: Tabela net.http_request não acessível ou sem registros:', e.message);
        }

        console.log('\n--- Verificando Config do WhatsApp ---');
        const config = await client.query("SELECT whatsapp_api_url, whatsapp_api_instance FROM public.store_config WHERE id = 1");
        console.table(config.rows);

    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await client.end();
    }
}
debugNet();
