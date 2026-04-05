const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkNetQueue() {
    try {
        await client.connect();

        console.log('--- Verificando Fila de Requisições (net.http_request_queue) ---');
        // Usamos as colunas descobertas na inspeção
        const res = await client.query(`
            SELECT id, method, url, timeout_milliseconds 
            FROM net.http_request_queue 
            ORDER BY id DESC 
            LIMIT 5
        `);
        console.log('Fila recente:', JSON.stringify(res.rows, null, 2));

        console.log('--- Verificando Respostas (net._http_response) ---');
        const resp = await client.query(`
            SELECT id, status_code, content, created_at 
            FROM net._http_response 
            ORDER BY created_at DESC 
            LIMIT 5
        `);
        console.log('Respostas recentes:', JSON.stringify(resp.rows, null, 2));

    } catch (err) {
        console.error('Erro ao ler fila/respostas:', err.message);
    } finally {
        await client.end();
    }
}
checkNetQueue();
