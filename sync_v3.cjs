const http = require('http');
const { Client } = require('pg');

const config = {
    apiKey: '4296144a114008779090b83e370f2a96',
    instanceName: 'Evolution_Miracle_Final',
    localApiUrl: 'http://localhost:8080',
    supabaseConn: process.env.DATABASE_URL || `postgresql://postgres:${encodeURIComponent(process.env.DB_PASSWORD || 'PLACEHOLDER')}@db.cafkrminfnokvgjqtkle.supabase.co:5432/postgres`
};

async function sync() {
    console.log('--- Iniciando Sincronização v3 ---');

    try {
        // 1. Obter URL do Ngrok
        console.log('1. Buscando URL do Ngrok...');
        const tunnels = await new Promise((resolve, reject) => {
            http.get('http://localhost:4040/api/tunnels', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(JSON.parse(data)));
            }).on('error', (err) => reject(new Error('Ngrok não encontrado no porto 4040.')));
        });

        const publicUrl = tunnels.tunnels.find(t => t.config.addr === 'http://localhost:8080')?.public_url;
        if (!publicUrl) throw new Error('Nenhum túnel Ngrok encontrado para localhost:8080.');
        console.log('✅ URL Pública:', publicUrl);

        // 2. Atualizar Supabase
        console.log('2. Atualizando store_config no Supabase...');
        const client = new Client({ connectionString: config.supabaseConn });
        await client.connect();
        await client.query('UPDATE public.store_config SET whatsapp_api_url = $1 WHERE id = 1', [publicUrl]);
        await client.end();
        console.log('✅ Supabase atualizado.');

        // 3. Verificar/Criar Instância na Evolution API
        console.log('3. Verificando instância na Evolution API...');
        const fetchRes = await fetch(`${config.localApiUrl}/instance/fetchInstances`, {
            headers: { 'apikey': config.apiKey }
        });
        const instances = await fetchRes.json();
        
        const instance = instances.find(i => i.instanceName === config.instanceName);
        
        if (!instance) {
            console.log(`Instância ${config.instanceName} não encontrada. Criando...`);
            await fetch(`${config.localApiUrl}/instance/create`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'apikey': config.apiKey 
                },
                body: JSON.stringify({
                    instanceName: config.instanceName,
                    token: config.apiKey,
                    number: '',
                    qrcode: true
                })
            });
            console.log('✅ Instância criada. Por favor, conecte o QR Code no painel da Evolution.');
        } else {
            console.log(`✅ Instância ${config.instanceName} já existe e está pronta.`);
        }

        console.log('\n--- Sincronização Concluída com Sucesso! ---');
        console.log('Agora use o Marketplace e o WhatsApp deve disparar as notificações.');

    } catch (err) {
        console.error('\n❌ Erro durante a sincronização:', err.message);
        console.log('\nCertifique-se de que:');
        console.log('1. Docker com Evolution API está rodando (porta 8080)');
        console.log('2. Ngrok está rodando com: ngrok http 8080');
    }
}

sync();
