const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'Evolution_Ultra';

function request(path, method, body) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'localhost',
            port: 8080,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'apikey': apikey
            }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data || '{}') });
                } catch (e) {
                    resolve({ status: res.statusCode, data: { raw: data } });
                }
            });
        });
        req.on('error', (e) => resolve({ status: 500, data: { error: e.message } }));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    console.log(`--- REINICIANDO COM INTEGRACAO DATABASE: ${instanceName} ---`);
    try {
        // 1. Deletar
        await request('/instance/delete/' + instanceName, 'DELETE');

        // 2. Criar com integration WHATSAPP-BAILEYS mas forçando persistência (padrão em versões novas)
        const createRes = await request('/instance/create', 'POST', {
            instanceName: instanceName,
            token: apikey,
            qrcode: true
        });
        console.log('Create Status:', createRes.status);
        console.log('Create Data:', JSON.stringify(createRes.data));

        if (createRes.status === 201) {
            console.log('Aguardando QR Code...');
            for (let i = 1; i <= 15; i++) {
                console.log(`Tentativa ${i}/15...`);
                // Usar o endpoint que traz o base64 diretamente se disponível no create ou connect
                const connectRes = await request(`/instance/connect/${instanceName}`, 'GET');
                if (connectRes.data && (connectRes.data.base64 || connectRes.data.code)) {
                    const qrBase64 = connectRes.data.base64 || connectRes.data.code;
                    const html = `
                        <html>
                        <body style="background: #1a1a1a; color: white; text-align: center; font-family: sans-serif;">
                            <h1 style="color: #25D366;">WhatsApp Evolution API</h1>
                            <h2>PRONTO PARA ESCANEAR</h2>
                            <div style="background: white; padding: 20px; display: inline-block; border-radius: 20px;">
                                <img src="${qrBase64}" />
                            </div>
                            <p>Escaneie agora para ativar as notificacoes de pedidos.</p>
                        </body>
                        </html>
                    `;
                    fs.writeFileSync('QR_CODE_ULTRA.html', html);
                    console.log('SUCESSO: QR Code capturado!');
                    return;
                }
                await new Promise(r => setTimeout(r, 4000));
            }
        }
    } catch (e) {
        console.error('Erro:', e.message);
    }
}
run();
