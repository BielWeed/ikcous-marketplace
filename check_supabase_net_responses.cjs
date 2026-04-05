const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkNetResponses() {
    try {
        await client.connect();

        console.log('--- Verificando Respostas de HTTP na schema "net" ---');
        // Tentando consultar _http_response que vimos na listagem anterior
        const res = await client.query(`
            SELECT id, status_code, content, created_at 
            FROM net._http_response 
            ORDER BY created_at DESC 
            LIMIT 5
        `);

        console.log('Respostas recentes:', JSON.stringify(res.rows, null, 2));

    } catch (err) {
        console.error('❌ Erro ao ler respostas:', err.message);

        console.log('--- Tentando buscar na tabela sem underscore caso seja um alias ---');
        try {
            const res2 = await client.query(`SELECT * FROM net.http_response ORDER BY id DESC LIMIT 5`);
            console.log('Respostas (http_response):', JSON.stringify(res2.rows, null, 2));
        } catch (e) {
            console.log('http_response também falhou.');
        }
    } finally {
        await client.end();
    }
}

checkNetResponses();
