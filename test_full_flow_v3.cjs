const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

const anonKey = 'sb_publishable_oQVYWgiuv3Qv8jPLCOHwvg_5X7tyAtD';

async function runFullTest() {
    try {
        await client.connect();

        console.log('--- Configurando Header da Sessão ---');
        await client.query(`SELECT set_config('request.headers', '{"apikey": "${anonKey}"}', true)`);

        await client.query('BEGIN');

        console.log('--- Inserindo Pedido ---');
        const orderRes = await client.query(`
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
                'Teste Antigravity Completo v3',
                $1,
                129.90,
                119.90,
                10.00,
                0.00,
                'pix',
                'pending',
                NOW()
            ) RETURNING id
        `, [JSON.stringify({ whatsapp: '553492589326' })]);

        const orderId = orderRes.rows[0].id;
        console.log(`✅ Pedido inserido: ${orderId}`);

        console.log('--- Inserindo Item do Pedido ---');
        await client.query(`
            INSERT INTO public.marketplace_order_items (
                order_id,
                product_name,
                quantity,
                price
            ) VALUES (
                $1,
                'Produto Teste Antigravity',
                1,
                119.90
            )
        `, [orderId]);

        await client.query('COMMIT');
        console.log('✅ COMMIT realizado com sucesso.');

        console.log('--- Aguardando 15s para processamento ---');
        await new Promise(resolve => setTimeout(resolve, 15000));

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Erro no teste:', err.message);
    } finally {
        await client.end();
    }
}

runFullTest();
