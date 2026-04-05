const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

const anonKey = 'sb_publishable_oQVYWgiuv3Qv8jPLCOHwvg_5X7tyAtD';

async function finalTest() {
    try {
        await client.connect();

        console.log('--- Configurando Header da Sessão ---');
        await client.query(`SELECT set_config('request.headers', '{"apikey": "${anonKey}"}', true)`);

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
                NULL,
                'Teste Final Antigravity - SUCESSO',
                $1,
                250.00,
                240.00,
                10.00,
                0.00,
                'pix',
                'pending',
                NOW()
            ) RETURNING id
        `, [JSON.stringify({ whatsapp: '553492589326' })]);

        const orderId = res.rows[0].id;
        console.log('✅ Pedido inserido com sucesso! ID:', orderId);

        console.log('--- Aguardando processamento da Edge Function (15s) ---');
        await new Promise(resolve => setTimeout(resolve, 15000));

        console.log('--- Fim do teste. Favor verificar logs da Evolution API ---');

    } catch (err) {
        console.error('❌ Erro no teste final:', err.message);
    } finally {
        await client.end();
    }
}

finalTest();
