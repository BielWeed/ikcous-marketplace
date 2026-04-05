const { Client } = require('pg');

async function testPriceBypass() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();

        // 1. Pegar um produto real para o teste
        const prodRes = await client.query('SELECT id, preco_venda FROM produtos LIMIT 1');
        if (prodRes.rows.length === 0) {
            console.error('Nenhum produto encontrado para o teste');
            return;
        }
        const product = prodRes.rows[0];
        console.log(`Testando com produto ID: ${product.id}, Preço Real: ${product.preco_venda}`);

        // 2. Tentar criar pedido com preço manipulado (R$ 1.00 em vez do original)
        // Usamos set_config para simular o usuário logado (precisamos de um ID real se o RPC checar auth.uid())
        // Mas como estamos via Postgres direto, podemos usar um ID de teste ou apenas ver se a lógica de cálculo funciona.
        // O RPC V20 checa auth.uid(), então precisamos setar a sessão.

        await client.query("SELECT set_config('auth.uid', '00000000-0000-0000-0000-000000000000', true)"); // Placeholder UUID

        const items = JSON.stringify([{
            product_id: product.id,
            quantity: 1,
            price: 1.00 // Preço falso enviado pelo frontend
        }]);

        console.log('Tentando bypass de preço...');
        try {
            await client.query(`
                SELECT public.create_marketplace_order_v20(
                    $1, -- p_items
                    1.00, -- p_total_amount (MANIPULADO)
                    0, -- p_shipping_cost
                    'pix', -- p_payment_method
                    NULL, -- p_address_id
                    NULL, -- p_coupon_code
                    'Test Bot',
                    '5534999999999',
                    'Security Test'
                )
            `, [items]);
            console.error('ERRO: O RPC ACEITOU O PREÇO MANIPULADO! FALHA DE SEGURANÇA!');
        } catch (err) {
            if (err.message.includes('Manipulação de preço detectada')) {
                console.log('SUCESSO: O RPC REJEITOU O PREÇO MANIPULADO!');
                console.log('Mensagem de erro:', err.message);
            } else {
                console.error('O RPC falhou por outro motivo:', err.message);
            }
        }

    } catch (err) {
        console.error('Erro no script de teste:', err);
    } finally {
        await client.end();
    }
}

testPriceBypass();
