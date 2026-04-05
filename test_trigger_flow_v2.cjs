const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

const anonKey = 'sb_publishable_oQVYWgiuv3Qv8jPLCOHwvg_5X7tyAtD';
const userId = 'eaaf8550-41b4-b6e0-5c91-66cd8a855016';

async function runTest() {
    try {
        await client.connect();

        console.log('--- Configurando Header da Sessão ---');
        await client.query(`SELECT set_config('request.headers', '{"apikey": "${anonKey}", "authorization": "Bearer ${anonKey}"}', true)`);

        console.log('--- Inserindo Pedido de Teste Completo ---');
        // Precisamos incluir TODOS os campos NOT NULL sem default:
        // user_id, customer_name, customer_data, total, subtotal, shipping, discount, payment_method
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
                'Teste Antigravity Final',
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

        console.log('--- Aguardando 5 segundos para o trigger processar ---');
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log('--- Verificando Logs pg_net ---');
        const netLogs = await client.query("SELECT * FROM net.http_request ORDER BY id DESC LIMIT 1");
        if (netLogs.rows.length > 0) {
            console.log('Último Log pg_net:', JSON.stringify(netLogs.rows[0], null, 2));
        } else {
            console.log('Nenhum log encontrado em net.http_request');
        }

    } catch (err) {
        console.error('❌ Erro no teste:', err.message);
    } finally {
        await client.end();
    }
}

runTest();
