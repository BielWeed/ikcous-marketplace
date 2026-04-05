const https = require('https');
const fs = require('node:fs');
const path = require('path');

const apikey = '4296144a114008779090b83e370f2a96';
const baseUrl = 'tired-deer-speak.loca.lt';
const instanceName = 'MainInstance';

function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: baseUrl,
            path: path,
            headers: { 'apikey': apikey }
        };

        const req = https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', (e) => reject(e));
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Timeout na requisição'));
        });
    });
}

async function start() {
    try {
        console.log('--- Verificando Conexão ---');
        const stateRes = await makeRequest(`/instance/connectionState/${instanceName}`);
        console.log('Status HTTP:', stateRes.status);

        if (!stateRes.body) {
            throw new Error('Servidor retornou corpo vazio. O túnel pode estar bloqueado ou desligado.');
        }

        const data = JSON.parse(stateRes.body);
        const state = data.instance?.state;
        console.log('Estado:', state);

        if (state === 'open') {
            console.log('WhatsApp já está CONECTADO!');
            return;
        }

        console.log('--- Buscando QR Code ---');
        const qrRes = await makeRequest(`/instance/connect/${instanceName}`);
        const qrData = JSON.parse(qrRes.body);

        if (qrData.base64) {
            const htmlPath = path.join(__dirname, 'CONECTAR_WHATSAPP.html');
            const htmlContent = `
                <html>
                <head><title>Conectar WhatsApp</title></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h1>Escaneie o QR Code para conectar</h1>
                    <div style="margin: 20px; border: 1px solid #ccc; display: inline-block; padding: 20px;">
                        <img src="${qrData.base64}" alt="QR Code" />
                    </div>
                    <p>Após escanear, aguarde alguns segundos.</p>
                </body>
                </html>
            `;
            fs.writeFileSync(htmlPath, htmlContent);
            console.log('SUCCESS: Arquivo criado em: ' + htmlPath);
        } else {
            console.log('Servidor não retornou QR Code. Tente reiniciar o container ou aguarde.');
        }
    } catch (e) {
        console.error('Erro:', e.message);
    }
}

start();
