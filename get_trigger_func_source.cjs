const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function getFunctionSource() {
    try {
        await client.connect();

        console.log('--- Buscando código-fonte da função handle_new_order_whatsapp ---');
        const res = await client.query(`
            SELECT prosrc 
            FROM pg_proc 
            WHERE proname = 'handle_new_order_whatsapp'
        `);

        if (res.rows.length > 0) {
            console.log('CÓDIGO-FONTE:');
            console.log(res.rows[0].prosrc);
        } else {
            console.log('Função não encontrada.');
        }

    } catch (err) {
        console.error('Erro ao buscar função:', err.message);
    } finally {
        await client.end();
    }
}
getFunctionSource();
