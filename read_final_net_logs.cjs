const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkFinalNetLogs() {
    try {
        await client.connect();

        console.log('--- Lendo TODAS as Respostas de Rede (_http_response) ---');
        // Usando o conhecimento da inspeção anterior
        const res = await client.query(`
            SELECT id, status_code, content, request_id 
            FROM net._http_response 
            ORDER BY id DESC 
            LIMIT 10
        `);

        console.log('RESPOSTAS RECENTES:');
        res.rows.forEach(r => {
            console.log(`ID: ${r.id} | Status: ${r.status_code} | ReqID: ${r.request_id} | Conteúdo: ${r.content?.slice(0, 100)}...`);
        });

    } catch (err) {
        console.error('Erro ao ler logs finais:', err.message);
    } finally {
        await client.end();
    }
}
checkFinalNetLogs();
