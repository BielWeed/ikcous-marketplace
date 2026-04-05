const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

const anonKey = 'sb_publishable_oQVYWgiuv3Qv8jPLCOHwvg_5X7tyAtD';
const userId = '58ee6183-8c58-4100-b65c-f4c6cd956108'; // ID verificado que já possui pedidos

async function runTest() {
    try {
        await client.connect();

        console.log('--- Configurando Header da Sessão ---');
        await client.query(`SELECT set_config('request.headers', '{"apikey": "${anonKey}", "authorization": "Bearer ${anonKey}"}', true)`);

        console.log('--- Inserindo Pedido de Teste Final ---');
        const res = await client.query(`
            INSERT INTO public.marketplace_orders (
                user_id,
                customer_name,
                customer_data,
                total,
                subtotal,
                shipping,
                discount,
                payment_method,
                status,
                created_at
            ) VALUES (
                $1,
                'Teste Antigravity Final V3',
                $2,
                150.00,
                130.00,
                20.00,
                0.00,
                'pix',
                'pending',
                NOW()
            ) RETURNING id
        `, [userId, JSON.stringify({ whatsapp: '553492589326' })]);

        const orderId = res.rows[0].id;
        console.log('✅ Pedido inserido com sucesso! ID:', orderId);

        console.log('--- Aguardando 10 segundos para o trigger e pg_net processarem ---');
        await new Promise(resolve => setTimeout(resolve, 10000));

        console.log('--- Verificando Logs pg_net (net.http_request) ---');
        const netLogs = await client.query(`
            SELECT id, url, status, response_body, created_at 
            FROM net.http_request 
            WHERE url LIKE '%send-order-whatsapp%' 
            ORDER BY created_at DESC 
            LIMIT 1
        `);

        if (netLogs.rows.length > 0) {
            console.log('Último Log pg_net:', JSON.stringify(netLogs.rows[0], null, 2));
        } else {
            console.log('⚠️ Nenhum log encontrado em net.http_request para a Edge Function.');
            console.log('Verificando se houve algum erro no pg_net...');
            const allLogs = await client.query("SELECT * FROM net.http_request ORDER BY id DESC LIMIT 5");
            console.log('Últimos 5 Logs Gerais:', JSON.stringify(allLogs.rows, null, 2));
        }

    } catch (err) {
        console.error('❌ Erro no teste:', err.message);
        if (err.detail) console.error('Detalhe:', err.detail);
    } finally {
        await client.end();
    }
}

runTest();
