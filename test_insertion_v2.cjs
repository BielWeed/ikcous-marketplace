const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

const anonKey = 'sb_publishable_oQVYWgiuv3Qv8jPLCOHwvg_5X7tyAtD';

async function runTest() {
    try {
        await client.connect();

        console.log('--- Configurando Header da Sessão ---');
        await client.query(`SELECT set_config('request.headers', '{"apikey": "${anonKey}"}', true)`);

        console.log('--- Inserindo Pedido de Teste com USER_ID NULL ---');
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
                'Teste Antigravity Sem UserID v2',
                $1,
                150.00,
                140.00,
                10.00,
                0.00,
                'pix',
                'pending',
                NOW()
            ) RETURNING id
        `, [JSON.stringify({ whatsapp: '553492589326' })]);

        const orderId = res.rows[0].id;
        console.log('✅ Pedido inserido com sucesso! ID:', orderId);

        console.log('--- Verificando se a extensão pg_net está habilitada ---');
        const extensions = await client.query("SELECT * FROM pg_extension WHERE extname = 'pg_net'");
        console.log('Extensão pg_net:', extensions.rows.length > 0 ? 'Habilitada' : 'NÃO habilitada');

        if (extensions.rows.length > 0) {
            console.log('--- Verificando requests na schema "net" ---');
            // Supabase costuma ter a schema net. Tentaremos listar as tabelas dela.
            const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'net'");
            console.log('Tabelas na schema net:', tables.rows.map(t => t.table_name));
        }

    } catch (err) {
        console.error('❌ Erro no teste:', err.message);
    } finally {
        await client.end();
    }
}

runTest();
