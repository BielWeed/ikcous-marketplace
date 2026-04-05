const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'Evolution_Prime';

function get(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 8080,
            path: path,
            method: 'GET',
            headers: { 'apikey': apikey }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data || '{}') }));
        });
        req.on('error', reject);
        req.end();
    });
}

async function run() {
    console.log(`--- BUSCANDO QR CODE PARA ${instanceName} ---`);
    for (let i = 1; i <= 10; i++) {
        console.log(`Tentativa ${i}/10...`);
        try {
            const connectRes = await get(`/instance/connect/${instanceName}`);
            if (connectRes.data && connectRes.data.base64) {
                const qrBase64 = connectRes.data.base64;
                const html = `
                    <html>
                    <body style="background: #1a1a1a; color: white; text-align: center; font-family: sans-serif;">
                        <h1>WhatsApp Evolution - INSTANCIA PRIME</h1>
                        <p>Escaneie o QR Code abaixo para ativar as notificacoes.</p>
                        <img src="${qrBase64}" style="border: 10px solid white; border-radius: 10px; margin: 20px;" />
                        <p>Status: PRONTO PARA PAREAR (Capturado em: ${new Date().toLocaleString()})</p>
                    </body>
                    </html>
                `;
                fs.writeFileSync('QR_CODE_PRIME.html', html);
                console.log('SUCCESS: QR CODE SALVO EM QR_CODE_PRIME.html');
                return;
            } else {
                console.log('Ainda nao disponivel...');
            }
        } catch (e) {
            console.error('Erro na tentativa:', e.message);
        }
        await new Promise(r => setTimeout(r, 3000));
    }
    console.log('TIMEOUT: QR Code nao apareceu após 10 tentativas.');
}

run();
