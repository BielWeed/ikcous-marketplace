const http = require('http');
const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`;

async function syncTunnel() {
    try {
        console.log('--- Buscando URL do Ngrok ---');
        const tunnelData = await new Promise((resolve, reject) => {
            http.get('http://localhost:4040/api/tunnels', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(JSON.parse(data)));
            }).on('error', reject);
        });

        const publicUrl = tunnelData.tunnels[0].public_url;
        console.log('URL Pública encontrada:', publicUrl);

        const client = new Client({ connectionString });
        await client.connect();

        console.log('--- Atualizando store_config ---');
        await client.query(`
            UPDATE public.store_config 
            SET whatsapp_api_url = $1
            WHERE id = 1
        `, [publicUrl]);

        console.log('✅ store_config atualizada com sucesso!');
        await client.end();

    } catch (err) {
        console.error('❌ Erro:', err.message);
    }
}

syncTunnel();
