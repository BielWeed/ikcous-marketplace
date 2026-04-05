const { Client } = require('pg');

async function updateConfig() {
    // String de conexão direta encontrada no projeto
    const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;
    const client = new Client({ connectionString });

    try {
        await client.connect();

        const tunnelUrl = 'https://ten-tender-feet-eat.loca.lt';
        const instanceName = 'Evolution_Miracle_Final';
        const apiKey = '4296144a114008779090b83e370f2a96';

        console.log(`Atualizando store_config...`);
        console.log(`URL: ${tunnelUrl}`);
        console.log(`Instance: ${instanceName}`);

        const res = await client.query(`
            UPDATE public.store_config 
            SET whatsapp_api_url = $1,
                whatsapp_api_key = $2,
                whatsapp_api_instance = $3
            WHERE id = 1
            RETURNING *;
        `, [tunnelUrl, apiKey, instanceName]);

        if (res.rowCount > 0) {
            console.log('✅ Configuração atualizada com sucesso no Supabase!');
            console.log('Resultado:', res.rows[0]);
        } else {
            console.error('❌ Nenhuma linha atualizada. ID 1 existe na store_config?');
        }

    } catch (err) {
        console.error('❌ Erro na atualização:', err);
    } finally {
        await client.end();
    }
}

updateConfig();
