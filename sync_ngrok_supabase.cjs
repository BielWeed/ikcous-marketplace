const { Client } = require('pg');

async function updateConfig() {
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();

        const fs = require('node:fs');
        const path = require('path');
        const urlPath = path.join(__dirname, '../evolution-api/ngrok_url.txt');
        const tunnelUrl = fs.readFileSync(urlPath, 'utf8').trim();
        const instanceName = 'Evolution_Miracle_Final';
        const apiKey = '4296144a114008779090b83e370f2a96';

        console.log(`Atualizando store_config com Ngrok...`);
        console.log(`URL: ${tunnelUrl}`);

        const res = await client.query(`
            UPDATE public.store_config 
            SET whatsapp_api_url = $1,
                whatsapp_api_key = $2,
                whatsapp_api_instance = $3
            WHERE id = 1
            RETURNING *;
        `, [tunnelUrl, apiKey, instanceName]);

        if (res.rowCount > 0) {
            console.log('✅ Configuração sincronizada com Ngrok!');
        } else {
            console.error('❌ Erro: Registro id=1 não encontrado.');
        }

    } catch (err) {
        console.error('❌ Erro Completo:', err);
    } finally {
        await client.end();
    }
}

updateConfig();
