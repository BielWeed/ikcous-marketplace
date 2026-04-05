const http = require('http');
const fs = require('node:fs');
const path = require('path');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'Evolution_Prime';

function post(path, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 8080,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': apikey
            }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data || '{}') }));
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

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
    console.log('--- CRIANDO INSTANCIA PRIME ---');
    try {
        // Criar
        const createRes = await post('/instance/create', {
            instanceName: instanceName,
            token: apikey,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS'
        });
        console.log('Create Status:', createRes.status);
        console.log('Create Data:', JSON.stringify(createRes.data));

        if (createRes.status === 201 || createRes.status === 200 || createRes.data?.instance?.instanceName) {
            console.log('Sucesso! Aguardando QR...');
            await new Promise(r => setTimeout(r, 5000));

            // Pegar QR
            const connectRes = await get(`/instance/connect/${instanceName}`);
            console.log('Connect Status:', connectRes.status);

            if (connectRes.data && connectRes.data.code) {
                const qrBase64 = connectRes.data.code;
                const html = `
                    <html>
                    <body style="background: #1a1a1a; color: white; text-align: center; font-family: sans-serif;">
                        <h1>WhatsApp Evolution - INSTANCIA PRIME</h1>
                        <p>Escaneie o QR Code abaixo para ativar as notificacoes.</p>
                        <img src="${qrBase64}" style="border: 10px solid white; border-radius: 10px; margin: 20px;" />
                        <p>Status: PRONTO PARA PAREAR</p>
                    </body>
                    </html>
                `;
                fs.writeFileSync('QR_CODE_PRIME.html', html);
                console.log('QR CODE SALVO EM QR_CODE_PRIME.html');
            } else {
                console.log('QR nao recebido. Tente rodar novamente em alguns segundos.');
                console.log('Response Connect:', JSON.stringify(connectRes.data));
            }
        } else {
            console.log('Falha ao criar.');
        }
    } catch (e) {
        console.error('ERRO:', e.message);
    }
}

run();
