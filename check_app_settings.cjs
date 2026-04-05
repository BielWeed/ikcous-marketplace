const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkAppSettings() {
    try {
        await client.connect();

        console.log('--- Verificando Tabela app_settings ---');
        const res = await client.query(`
            SELECT key, value 
            FROM public.app_settings 
            WHERE key = 'supabase_service_role_key'
        `);

        if (res.rows.length > 0) {
            console.log('Configuração atual:', JSON.stringify(res.rows[0], null, 2));
        } else {
            console.log('❌ Chave supabase_service_role_key não encontrada na app_settings.');
        }

    } catch (err) {
        console.error('❌ Erro ao ler app_settings:', err.message);
    } finally {
        await client.end();
    }
}

checkAppSettings();
