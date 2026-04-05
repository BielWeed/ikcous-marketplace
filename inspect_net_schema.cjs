const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function main() {
    try {
        await client.connect();

        console.log('--- Tabelas no schema net ---');
        const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'net'");
        console.log(res.rows);

        console.log('\n--- Verificando a função de gatilho handle_new_order_whatsapp ---');
        const func = await client.query("SELECT prosrc FROM pg_proc WHERE proname = 'handle_new_order_whatsapp'");
        if (func.rows.length > 0) {
            console.log('Código do Gatilho:');
            console.log(func.rows[0].prosrc);
        } else {
            console.log('Gatilho não encontrado.');
        }

    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await client.end();
    }
}

main();
