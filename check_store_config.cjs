const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkConfig() {
    try {
        await client.connect();

        console.log('--- Verificando Tabela store_config (ID=1) ---');
        const res = await client.query(`
            SELECT whatsapp_api_url, whatsapp_api_key, whatsapp_api_instance 
            FROM public.store_config 
            WHERE id = 1
        `);

        console.log('Configuração atual:', JSON.stringify(res.rows[0], null, 2));

    } catch (err) {
        console.error('❌ Erro ao ler store_config:', err.message);
    } finally {
        await client.end();
    }
}

checkConfig();
