const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

const anonKey = 'sb_publishable_oQVYWgiuv3Qv8jPLCOHwvg_5X7tyAtD';

async function runTest() {
    try {
        await client.connect();

        console.log('--- Configurando Header da Sessão ---');
        // Usamos o anonKey para simular a apikey do header que o trigger espera
        await client.query(`SELECT set_config('request.headers', '{"apikey": "${anonKey}"}', true)`);

        console.log('--- Inserindo Pedido de Teste com USER_ID NULL ---');
        // Inserimos com user_id NULL para evitar erro de FK, já que a coluna permite NULL
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
                NULL,
                'Teste Antigravity Sem UserID',
                $1,
                99.99,
                89.99,
                10.00,
                0.00,
                'pix',
                'pending',
                NOW()
            ) RETURNING id
        `, [JSON.stringify({ whatsapp: '553492589326' })]);

        const orderId = res.rows[0].id;
        console.log('✅ Pedido inserido com sucesso! ID:', orderId);

        console.log('--- Aguardando 10 segundos para processamento ---');
        await new Promise(resolve => setTimeout(resolve, 10000));

        console.log('--- Verificando logs do pg_net (net.http_request) ---');
        const logs = await client.query(`
            SELECT id, url, status, response_body, created_at 
            FROM net.http_request 
            ORDER BY created_at DESC 
            LIMIT 3
        `);
        console.log('Logs recentes do pg_net:', JSON.stringify(logs.rows, null, 2));

    } catch (err) {
        console.error('❌ Erro no teste:', err.message);
    } finally {
        await client.end();
    }
}

runTest();
