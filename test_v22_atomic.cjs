const { Client } = require('pg');

async function testShield() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();
        
        // 1. Pegar um produto de teste e garantir que ele tenha pouco estoque
        const prodRes = await client.query("SELECT id, nome, estoque FROM produtos WHERE ativo = true AND estoque > 0 LIMIT 1");
        if (prodRes.rows.length === 0) {
            console.log("Nenhum produto com estoque encontrado para teste.");
            return;
        }
        
        const product = prodRes.rows[0];
        console.log(`Testando com produto: ${product.nome} | Estoque Atual: ${product.estoque}`);

        // 2. Tentar comprar MAIS do que o estoque (ex: estoque + 10)
        const buyQty = product.estoque + 10;
        console.log(`Tentando comprar ${buyQty} unidades...`);

        const items = JSON.stringify([{
            product_id: product.id,
            quantity: buyQty
        }]);

        // Simular chamada RPC via SQL
        try {
            // v22 exige vários parâmetros: p_items, p_total_amount, p_shipping_cost, p_payment_method, p_address_id
            await client.query(`
                SELECT public.create_marketplace_order_v22(
                    $1::jsonb, 
                    100.00, 
                    0, 
                    'pix', 
                    NULL, 
                    NULL, 
                    'Teste Antigravity', 
                    '999999999'
                )
            `, [items]);
            
            console.error("ERRO: O pedido deveria ter falhado por falta de estoque!");
        } catch (orderErr) {
            console.log("SUCESSO: O banco de dados bloqueou o pedido conforme esperado.");
            console.log("Mensagem de Erro do Postgres:", orderErr.message);
        }

        // 3. Verificar se o estoque permancenceu o mesmo (não decrementou)
        const checkRes = await client.query("SELECT estoque FROM produtos WHERE id = $1", [product.id]);
        if (checkRes.rows[0].estoque === product.estoque) {
            console.log("VALIDAÇÃO FINAL: Estoque intacto. Transação revertida com sucesso.");
        } else {
            console.error("ERRO CRÍTICO: O estoque foi alterado mesmo com a falha do pedido!");
        }

    } catch (err) {
        console.error('Erro no teste:', err);
    } finally {
        await client.end();
    }
}

testShield();
