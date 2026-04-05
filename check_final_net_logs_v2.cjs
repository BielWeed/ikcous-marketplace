const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function checkFinalNetLogs() {
    try {
        await client.connect();

        console.log('--- Lendo TODAS as Respostas de Rede (_http_response) ---');
        // Usamos as colunas que descobrimos na inspeção anterior (sem chutar nomes)
        const res = await client.query(`
            SELECT id, status_code, content, error_msg 
            FROM net._http_response 
            ORDER BY id DESC 
            LIMIT 10
        `);

        console.log('RESPOSTAS RECENTES:');
        res.rows.forEach(r => {
            console.log(`ID: ${r.id} | Status: ${r.status_code} | Erro: ${r.error_msg} | Conteúdo: ${r.content?.slice(0, 50)}...`);
        });

    } catch (err) {
        console.error('Erro ao ler logs finais:', err.message);
    } finally {
        await client.end();
    }
}
checkFinalNetLogs();
