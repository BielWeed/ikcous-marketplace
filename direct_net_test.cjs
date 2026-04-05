const { Client } = require('pg');
const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
const client = new Client({ connectionString });

async function directTest() {
    try {
        await client.connect();

        console.log('--- Buscando URL atual do Ngrok na store_config ---');
        const config = await client.query("SELECT whatsapp_api_url FROM public.store_config WHERE id = 1");
        const url = config.rows[0].whatsapp_api_url;
        console.log(`URL do Ngrok: ${url}`);

        console.log('--- Disparando net.http_post de teste direto para o Ngrok ---');
        // Tentamos um POST simples para o endpoint de status ou algo que responda
        const testRes = await client.query(`
            SELECT net.http_post(
                url := $1 || '/instance/fetchInstances',
                headers := '{"Content-Type": "application/json", "apikey": "B6774519D46242C483090ACA"}'::jsonb
            )
        `, [url]);

        const requestId = testRes.rows[0].http_post;
        console.log(`✅ Request ID gerado: ${requestId}`);

        console.log('--- Aguardando 10s para resposta ---');
        await new Promise(resolve => setTimeout(resolve, 10000));

        console.log('--- Verificando status da resposta ---');
        const resp = await client.query(`
            SELECT * FROM net._http_response WHERE request_id = $1
        `, [requestId]);

        if (resp.rows.length > 0) {
            console.log('RESPOSTA RECEBIDA:');
            console.log(JSON.stringify(resp.rows[0], null, 2));
        } else {
            console.log('Nenhuma resposta encontrada para este ID.');
        }

    } catch (err) {
        console.error('Erro no teste direto:', err.message);
    } finally {
        await client.end();
    }
}
directTest();
