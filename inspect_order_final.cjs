const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function check() {
    try {
        await client.connect();
        console.log('--- Último Pedido ---');
        const res = await client.query("SELECT * FROM public.marketplace_orders ORDER BY created_at DESC LIMIT 1");
        console.log(JSON.stringify(res.rows, null, 2));

        console.log('\n--- Status da Configuração de Notificação ---');
        const config = await client.query("SELECT * FROM public.store_config WHERE id = 1");
        console.log(JSON.stringify(config.rows, null, 2));

        console.log('\n--- Verificando Triggers na tabela marketplace_orders ---');
        const triggers = await client.query(`
            SELECT trigger_name, event_manipulation, action_statement, action_timing
            FROM information_schema.triggers
            WHERE event_object_table = 'marketplace_orders'
        `);
        console.table(triggers.rows);

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}
check();
