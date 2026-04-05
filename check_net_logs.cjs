const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkNetLogs() {
    try {
        await client.connect();

        console.log('--- Verificando Logs do pg_net (net.http_responses) ---');
        // Tentamos ver se a tabela existe no schema net
        const res = await client.query(`
            SELECT id, status_code, body, created_at 
            FROM net.http_responses 
            ORDER BY created_at DESC 
            LIMIT 10
        `);

        console.log('Logs pg_net:', JSON.stringify(res.rows, null, 2));

    } catch (err) {
        console.error('❌ Erro ao ler net.http_responses:', err.message);
    } finally {
        await client.end();
    }
}

checkNetLogs();
