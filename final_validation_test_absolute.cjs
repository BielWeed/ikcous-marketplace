const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function finalTestAbsolute() {
    try {
        await client.connect();

        console.log('--- Inserindo Pedido de Teste Final (ESTRUTURA REAL) ---');
        const orderRes = await client.query(`
            INSERT INTO public.marketplace_orders (
                total, 
                status, 
                payment_method, 
                delivery_method,
                address_id
            ) VALUES (
                150.00, 
                'pending', 
                'pix', 
                'delivery',
                '00000000-0000-0000-0000-000000000000'
            ) RETURNING id
        `);
        const orderId = orderRes.rows[0].id;
        console.log(`✅ Pedido criado: ${orderId}`);

        console.log('--- Inserindo Itens do Pedido ---');
        await client.query(`
            INSERT INTO public.marketplace_order_items (order_id, product_id, quantity, price)
            VALUES ($1, '00000000-0000-0000-0000-000000000000', 1, 150.00)
        `, [orderId]);
        console.log('✅ Itens inseridos.');

        console.log('--- Aguardando 15s para processamento ---');
        await new Promise(resolve => setTimeout(resolve, 15000));

        console.log('--- Verificando Resposta no Log de Rede ---');
        const logRes = await client.query(`
            SELECT status_code, content, error_msg 
            FROM net._http_response 
            ORDER BY id DESC 
            LIMIT 1
        `);

        if (logRes.rows.length > 0) {
            console.log('RESULTADO DA EDGE FUNCTION:');
            console.log(JSON.stringify(logRes.rows[0], null, 2));
        }

    } catch (err) {
        console.error('Erro no teste final:', err.message);
    } finally {
        await client.end();
    }
}
finalTestAbsolute();
