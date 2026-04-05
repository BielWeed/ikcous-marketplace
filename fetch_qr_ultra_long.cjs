const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'Evolution_Ultra';

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
    console.log(`--- BUSCANDO QR CODE PARA ${instanceName} (MUITAS TENTATIVAS) ---`);
    for (let i = 1; i <= 20; i++) {
        console.log(`Tentativa ${i}/20...`);
        try {
            const connectRes = await get(`/instance/connect/${instanceName}`);
            if (connectRes.data && (connectRes.data.base64 || connectRes.data.code)) {
                const qrBase64 = connectRes.data.base64 || connectRes.data.code;
                const html = `
                    <html>
                    <body style="background: #1a1a1a; color: white; text-align: center; font-family: sans-serif;">
                        <h1 style="color: #25D366;">WhatsApp Evolution API</h1>
                        <h2>INSTANCIA: ${instanceName}</h2>
                        <p>Escaneie o QR Code abaixo no seu WhatsApp Celular.</p>
                        <div style="background: white; padding: 20px; display: inline-block; border-radius: 20px;">
                            <img src="${qrBase64}" style="display: block;" />
                        </div>
                        <p style="margin-top: 20px; font-size: 0.9em; opacity: 0.7;">Capturado em: ${new Date().toLocaleString()}</p>
                        <p><b>Este QR Code expira rapido. Escaneie agora!</b></p>
                    </body>
                    </html>
                `;
                fs.writeFileSync('QR_CODE_ULTRA.html', html);
                console.log('SUCCESS: QR CODE SALVO EM QR_CODE_ULTRA.html');
                return;
            } else {
                console.log('Aguardando Baileys emitir o QR...');
                console.log('Response:', JSON.stringify(connectRes.data));
            }
        } catch (e) {
            console.error('Erro na tentativa:', e.message);
        }
        await new Promise(r => setTimeout(r, 4000));
    }
    console.log('TIMEOUT: QR Code nao apareceu após 20 tentativas.');
}

run();
