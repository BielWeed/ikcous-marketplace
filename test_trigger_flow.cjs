const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

const anonKey = 'sb_publishable_oQVYWgiuv3Qv8jPLCOHwvg_5X7tyAtD';
const userId = '1b8d20be-6851-4f22-974f-e66081b8d5a7';

async function runTest() {
    try {
        await client.connect();

        console.log('--- Configurando Header da Sessão ---');
        // Simular o header que o Supabase espera para o trigger repassar
        await client.query(`SELECT set_config('request.headers', '{"apikey": "${anonKey}", "authorization": "Bearer ${anonKey}"}', true)`);

        console.log('--- Inserindo Pedido de Teste ---');
        const res = await client.query(`
            INSERT INTO public.marketplace_orders (
                user_id,
                customer_name,
                customer_data,
                total,
                payment_method,
                status,
                created_at
            ) VALUES (
                $1,
                'Teste Antigravity Final',
                $2,
                123.45,
                'pix',
                'pending',
                NOW()
            ) RETURNING id
        `, [userId, JSON.stringify({ whatsapp: '553492589326' })]);

        const orderId = res.rows[0].id;
        console.log('✅ Pedido inserido com sucesso! ID:', orderId);

        console.log('--- Aguardando 5 segundos para o trigger processar ---');
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log('--- Verificando Logs de HTTP do Supabase (pg_net) ---');
        const netLogs = await client.query("SELECT * FROM net.http_request ORDER BY id DESC LIMIT 5");
        console.log('Logs pg_net:', JSON.stringify(netLogs.rows, null, 2));

    } catch (err) {
        console.error('❌ Erro no teste:', err.message);
    } finally {
        await client.end();
    }
}

runTest();
