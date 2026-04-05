const http = require('http');
const fs = require('node:fs');

const apikey = '4296144a114008779090b83e370f2a96';
const instanceName = 'MainInstance';

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 8080,
            path: path,
            method: method,
            headers: {
                'apikey': apikey,
                'Content-Type': 'application/json'
            }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function forceResetLocal() {
    try {
        console.log('--- Resetando via Localhost ---');
        await request('DELETE', `/instance/delete/${instanceName}`);
        await new Promise(r => setTimeout(r, 2000));

        const create = await request('POST', '/instance/create', {
            instanceName: instanceName,
            token: apikey,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS'
        });
        console.log('Criar:', create.status);

        await new Promise(r => setTimeout(r, 5000));
        const qr = await request('GET', `/instance/connect/${instanceName}`);
        console.log('Conectar Status:', qr.status);

        const data = JSON.parse(qr.body);
        if (data.base64) {
            const html = `<html><body style="text-align:center;padding:50px;"><h1>ESCANEIE ESTE QR CODE</h1><img src="${data.base64}" /></body></html>`;
            fs.writeFileSync('CONECTAR_WHATSAPP_AGORA.html', html);
            console.log('SUCCESS: Arquivo CONECTAR_WHATSAPP_AGORA.html criado.');
        } else {
            console.log('Sem QR Code. Verifique se o container está saudável.');
        }
    } catch (e) {
        console.error('Erro:', e.message);
    }
}

forceResetLocal();
