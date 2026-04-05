const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'MainInstance';

function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 8080,
            path: path,
            headers: { 'apikey': apikey }
        };

        const req = http.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
    });
}

async function run() {
    try {
        console.log('--- Tentando acesso local (localhost:8080) ---');
        const qrRes = await makeRequest(`/instance/connect/${instanceName}`);
        console.log('Status:', qrRes.status);

        if (qrRes.status === 200 || qrRes.status === 201) {
            const qrData = JSON.parse(qrRes.body);
            if (qrData.base64) {
                const html = `
                    <html>
                    <head><title>CONECTAR WHATSAPP</title></head>
                    <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                        <h1>Escaneie para ativar as notificações</h1>
                        <img src="${qrData.base64}" />
                        <p>Arquivo gerado automaticamente por Antigravity.</p>
                    </body>
                    </html>
                `;
                fs.writeFileSync('CONECTAR_WHATSAPP_AGORA.html', html);
                console.log('SUCCESS: Arquivo CONECTAR_WHATSAPP_AGORA.html criado na raiz.');
            } else {
                console.log('Instância pode já estar conectada ou em estado de erro.');
            }
        } else {
            console.log('Falha ao conectar. Status:', qrRes.status);
        }
    } catch (e) {
        console.error('Erro de conexão local:', e.message);
        console.log('Certifique-se que o Docker está rodando na porta 8080.');
    }
}

run();
